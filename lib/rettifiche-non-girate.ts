import { controlloAttivo, FERMA } from '@/lib/ripesature-controllo'
import { giaFattePagareSotto, perchePropri, descriviStessoPrezzo } from '@/lib/rettifiche-perche'
import { contoSulPacco } from '@/lib/conto-pacco'

// ── LE RETTIFICHE PAGATE DA UN MASTER E NON GIRATE SOTTO, COL CONTO DEL PACCO ──
// Le legge Rettifica Costi → «Rettifiche non girate sotto» (app/api/rettifiche/eliminate), che controlla chi chiede e il
// periodo. Qui c'e' il calcolo, separato dalla rotta per poterlo rifare sui dati veri di un master senza la sua sessione.
// `dal`/`al` = istanti (confini dei giorni di Roma). Solo letture.

const MOTIVO_GIA = 'Già fatta pagare sotto con un\'altra rettifica: qui c\'è solo il costo, non è una perdita'
const eur = (n: number) => '€ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',')
const giorno = (s: string) => new Date(s).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })

// PERCHE' UNA RICEVUTA NON E' SCESA. Dal 13/11/2026 la rotta di «Carica»/«Assorbi» (app/api/network/rettifiche) scrive
// sulla riga se l'ha assorbita il master col bottone o se l'ha scartata il portale perche' sotto si pagava uguale. Prima
// non si scriveva: per quelle righe si sa solo che non e' scesa.
function percheNonScesa(r: any, chi: string | null): string {
  if (r.propagazione === 'propagata') return `L'avevi girata a ${chi || 'chi sta sotto'} e poi l'hai cancellata in Rettifica Costi senza confermarla.`
  if (r.perche?.tipo === 'assorbita_a_mano') return 'L\'hai assorbita tu, col bottone «Assorbi»: non è stata girata a nessuno.'
  if (r.perche?.tipo === 'paga_uguale') return `Non girata: col tuo listino ${chi || 'chi sta sotto'} paga uguale anche col peso nuovo, quindi non c'era niente da chiedergli.`
  return 'Assorbita: non è stata girata sotto.'
}

export async function rettificheNonGirate(admin: any, mio: string, dal: string, al: string) {
  const campi = 'id,master_id,spedizione_id,numero_spedizione,differenza,fuori_sagoma,costo_fornitore,propagazione,perche,created_at,masters:master_id(nome)'
  const leggi = async (filtra: (q: any) => any, extra = '') => {
    const out: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await filtra(admin.from('rettifiche').select(campi + extra))
        .gte('created_at', dal).lte('created_at', al).order('created_at', { ascending: false }).order('id').range(da, da + 999)
      if (error) throw new Error(error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return out
  }

  // Ricevute da sopra, confermate (quindi gia' scalate a me), assorbite o caricate.
  const ricevute = await leggi(q => q.eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true)
    .in('propagazione', ['assorbita', 'propagata']))
  // Delle caricate, quali hanno ancora una figlia (in attesa o confermata): quelle sono girate.
  const caricate = ricevute.filter(r => r.propagazione === 'propagata').map(r => r.id)
  const conFiglia = new Set<string>()
  for (let i = 0; i < caricate.length; i += 300) {
    const { data } = await admin.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', caricate.slice(i, i + 300))
    for (const f of (data || []) as any[]) conFiglia.add(f.origine_rettifica_id)
  }
  // Il mio costo di detentore senza nessuno sotto da rettificare. Su queste, che sono righe MIE, anche l'esito del
  // controllo Poste (se l'ho acceso): se Poste le smentisce le ho pagate al fornitore per niente, e si contestano.
  // Sulle ricevute da sopra no: l'esito e' di chi ha caricato il file, e sotto non deve sapere che era sbagliata.
  const conPoste = await controlloAttivo(admin, mio)
  const mie = await leggi(q => q.eq('master_id', mio).eq('target_master_id', mio).eq('confermata', true),
    ',peso_reale,peso_volume_reale,supplementi_nomi' + (conPoste ? ',controllo' : ''))

  // GIA' FATTE PAGARE SOTTO NON SONO SOLDI PERSI (lib/rettifiche-perche). Sulla maggior parte di questi pacchi avevo
  // gia' fatto pagare la ripesatura a qualcuno sotto con un'altra rettifica (dalle misure del portale, da un file di
  // prima): il costo arrivato dopo resta a me perche' sotto non si chiede due volte, ma l'ho gia' incassato. Sulle
  // righe di MULTI del 05/11/2026 erano 2.635 su 2.675. Si dice riga per riga: a chi, quando, quanto.
  const ricevuteNonGirate = ricevute.filter(r => !(r.propagazione === 'propagata' && conFiglia.has(r.id)))
  const giaRicevute = await giaFattePagareSotto(admin, mio, ricevuteNonGirate.map(r => r.spedizione_id))
  const percheMie = await perchePropri(admin, mio, mie)
  const conti = await contoSulPacco(admin, mio, [...ricevuteNonGirate, ...mie].map(r => r.spedizione_id))

  const arr = (n: number) => Math.round(n * 100) / 100
  // I soldi del pacco e il gruppo. Prima il margine: se sul pacco ci perdo, sta fra le perse anche se l'avevo gia'
  // fatto pagare sotto (non e' bastato). Senza cliente non c'e' niente da incassare: e' il costo di una spedizione mia.
  const conto = (r: any) => {
    const c = r.spedizione_id ? conti.get(r.spedizione_id) : undefined
    if (!c) return { gruppo: 'nd', incassato: null, pagato_tot: null, margine: null, chi: null, numeri: '' }
    if (c.senzaCliente) return { gruppo: 'senza', incassato: null, pagato_tot: c.pagato, margine: null, chi: null, numeri: '' }
    if (c.incassato == null) return { gruppo: 'nd', incassato: null, pagato_tot: c.pagato, margine: null, chi: c.chi, numeri: '' }
    const margine = arr(c.incassato - c.pagato)
    return { gruppo: margine < -0.005 ? 'perdi' : 'guadagni', incassato: c.incassato, pagato_tot: c.pagato, margine, chi: c.chi,
      numeri: `${c.chi} ti ha pagato ${eur(c.incassato)}; tu, rettifica compresa, ${eur(c.pagato)}: `
        + (margine < -0.005 ? `ci perdi ${eur(-margine)}.` : `ci guadagni ancora ${eur(margine)}.`) }
  }
  const fraseGia = (g: any) => `Già fatta pagare a ${g.a} il ${giorno(g.il)}: ${eur(Number(g.euro || 0))}${g.confermata ? '' : ' (ancora da confermare)'}. Qui c'è solo il costo arrivato dopo, che sotto non si chiede una seconda volta.`
  const SENZA = 'Spedizione fatta dal tuo account senza un cliente: non c\'è nessuno a cui girarla, è il costo di una tua spedizione.'
  const righe: any[] = []
  for (const r of ricevute) {
    if (r.propagazione === 'propagata' && conFiglia.has(r.id)) continue
    // Quanto mi e' stato scalato: ripesatura (differenza, negativa = addebito) + supplementi fissi.
    const pagato = arr(-(Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)))
    if (pagato < 0.005) continue
    const gia = r.spedizione_id ? giaRicevute.get(r.spedizione_id) : undefined
    const c = conto(r)
    const gruppo = gia && c.gruppo !== 'perdi' ? 'gia' : c.gruppo
    righe.push({
      id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
      da: (r as any).masters?.nome || 'livello sopra', importo: pagato,
      recuperata: gia || null,
      motivo: gia ? MOTIVO_GIA
        : r.propagazione === 'assorbita'
          ? 'Assorbita: non girata sotto'
          : 'Caricata in Rettifica Costi e poi cancellata senza confermarla',
      gruppo, incassato: c.incassato, pagato_tot: c.pagato_tot, margine: c.margine, chi: c.chi,
      frase: gruppo === 'senza' ? SENZA : [c.numeri, gia ? fraseGia(gia) : percheNonScesa(r, c.chi)].filter(Boolean).join(' '),
    })
  }
  for (const r of mie) {
    const costo = arr(Number(r.costo_fornitore || 0))
    if (costo < 0.005) continue
    const p: any = percheMie.get(r.id)
    const c = conto(r)
    const gia = p?.tipo === 'gia_fatta_pagare'
    const gruppo = gia && c.gruppo !== 'perdi' ? 'gia' : c.gruppo
    const motivo = gia ? MOTIVO_GIA
      : p?.tipo === 'reso' ? 'Reso: il ritorno si paga col nolo del reso, non con la ripesatura'
      : p?.tipo === 'senza_voce' ? 'Il fornitore ha addebitato un importo senza dire per cosa (né chili né un supplemento conosciuto): il portale non sa a chi girarlo'
      : 'Solo a tuo carico: ' + descriviStessoPrezzo(p?.conto)
    righe.push({
      id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
      da: 'Tuo costo (contratto tuo)', importo: costo,
      recuperata: gia ? p.gia : null,
      motivo, gruppo, incassato: c.incassato, pagato_tot: c.pagato_tot, margine: c.margine, chi: c.chi,
      frase: gruppo === 'senza' ? SENZA : [c.numeri, gia ? fraseGia(p.gia) : motivo + '.'].filter(Boolean).join(' '),
      ...(conPoste && FERMA.has(r.controllo?.esito) ? { poste: r.controllo.motivo } : {}),
    })
  }
  righe.sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
  const somma = (rs: any[], k: string) => arr(rs.reduce((t, r) => t + Number(r[k] || 0), 0))
  const gruppi: Record<string, { n: number; euro: number; margine: number }> = {}
  for (const g of ['perdi', 'guadagni', 'gia', 'senza', 'nd']) {
    const rs = righe.filter(r => r.gruppo === g)
    gruppi[g] = { n: rs.length, euro: somma(rs, 'importo'), margine: somma(rs, 'margine') }
  }
  return { righe, totale: somma(righe, 'importo'), gruppi }
}
