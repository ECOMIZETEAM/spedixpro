import { controlloAttivo, FERMA } from '@/lib/ripesature-controllo'
import { giaFattePagareSotto, perchePropri, descriviStessoPrezzo, senzaChili, gruppoRicevuta, descriviNonGirata } from '@/lib/rettifiche-perche'
import { contoSulPacco } from '@/lib/conto-pacco'

// ── LE RETTIFICHE PAGATE DA UN MASTER E NON GIRATE SOTTO, COL PERCHE' ──
// Le legge Rettifica Costi → «Rettifiche non girate sotto» (app/api/rettifiche/eliminate), che controlla chi chiede e il
// periodo. Qui c'e' il calcolo, separato dalla rotta per poterlo rifare sui dati veri di un master senza la sua sessione.
// `dal`/`al` = istanti (confini dei giorni di Roma). Solo letture.
//
// I GRUPPI SONO IL PERCHE', NON IL MARGINE. Fino al 16/11/2026 si facevano sul conto del pacco (incassato meno pagato):
// «Ci perdi» e «Ci guadagni comunque». Lorenzo, 15/11: «ci perdi non deve esistere.. pensano che stanno perdendo soldi» e
// «ci guadagni comunque sembra che non ha recuperato la rettifica». Rifatte riga per riga le 138 di Ecomize Solution: 103
// erano pacchi su cui il cliente, col SUO listino e il SUO divisore, stava nella stessa fascia anche col collo
// rimisurato; 26 assorbite da Ecomize; 4 clienti col listino che non arriva al collo; 5 girate e poi cancellate (4 per un
// listino che salta da 5,94 € a 24,51 €). Nessuna era un errore della piattaforma. Ora si dice quello.
//   uguale     chi sta sotto paga uguale anche col collo rimisurato
//   assorbite  non girata per scelta (bottone «Assorbi»; prima del 13/11 non si sa se il master o il portale)
//   listino    il listino di chi sta sotto non arriva a quel collo: va alzato
//   cancellate girata e poi cancellata in Rettifica Costi senza confermarla
//   gia        gia' fatta pagare sotto con un'altra rettifica
//   senza      spedizione fatta dal suo account senza un cliente
//   altre      sue righe di detentore: resi, importi senza una voce
// Da recuperare: listino, cancellate, assorbite, altre. Niente da recuperare: uguale, gia, senza — la pagina le tiene in
// un riquadro a parte (Lorenzo, 18/11/2026: «queste allora separale»). Rifatta su tutte le 2.729 righe di MULTI la
// decisione di «Carica» col motore: in quelle tre non c'era un euro da chiedere sotto.

const eur = (n: number) => '€ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',')
const giorno = (s: string) => new Date(s).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })

export const GRUPPI_NON_GIRATE = ['uguale', 'assorbite', 'listino', 'cancellate', 'gia', 'senza', 'altre'] as const

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

  // Ricevute da sopra, confermate (quindi gia' scalate a me), assorbite o caricate. Fuori quelle senza chili
  // (senzaChili in lib/rettifiche-perche): chi le ha ricevute non le vede.
  const ricevute = (await leggi(q => q.eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true)
    .in('propagazione', ['assorbita', 'propagata']))).filter(r => !senzaChili(r))
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
  // Dal conto del pacco servono solo chi sta subito sotto e se la spedizione e' mia senza cliente.
  const conti = await contoSulPacco(admin, mio, [...ricevuteNonGirate, ...mie].map(r => r.spedizione_id))

  const arr = (n: number) => Math.round(n * 100) / 100
  const fraseGia = (g: any) => `Già fatta pagare a ${g.a} il ${giorno(g.il)}: ${eur(Number(g.euro || 0))}${g.confermata ? '' : ' (ancora da confermare)'}. Qui c'è solo il costo arrivato dopo, che sotto non si chiede una seconda volta.`
  const SENZA = 'Spedizione fatta dal tuo account senza un cliente: non c\'è nessuno a cui girarla, è il costo di una tua spedizione.'
  const righe: any[] = []
  // CHIUSE: righe che Lorenzo ha deciso di non recuperare piu' (perche.tipo 'chiusa'). Il 18/11/2026, sulle 44 di
  // MULTI rimaste con qualcosa da chiedere sotto (68,12 €: 35 SDA EXPRESS L la cui prima ripesatura del 15/10 era stata
  // annullata sopra mentre quella verso il figlio restava, 9 Poste Delivery Business S rettificate a meta' ottobre per
  // meno dell'addebito arrivato dopo): «queste ormai levale». Escono dall'elenco; la riga e i soldi restano com'erano.
  const chiusa = (r: any) => r?.perche?.tipo === 'chiusa'
  for (const r of ricevuteNonGirate) {
    if (chiusa(r)) continue
    // Quanto mi e' stato scalato: ripesatura (differenza, negativa = addebito) + supplementi fissi.
    const pagato = arr(-(Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)))
    if (pagato < 0.005) continue
    const c = r.spedizione_id ? conti.get(r.spedizione_id) : undefined
    const gia = r.spedizione_id ? giaRicevute.get(r.spedizione_id) : undefined
    const gruppo = c?.senzaCliente ? 'senza' : gia ? 'gia' : gruppoRicevuta(r)
    righe.push({
      id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
      da: (r as any).masters?.nome || 'livello sopra', importo: pagato,
      recuperata: gia || null, gruppo, chi: r.perche?.chi || c?.chi || null,
      frase: gruppo === 'senza' ? SENZA : gruppo === 'gia' ? fraseGia(gia) : descriviNonGirata(r, c?.chi),
    })
  }
  for (const r of mie) {
    if (chiusa(r)) continue
    const costo = arr(Number(r.costo_fornitore || 0))
    if (costo < 0.005) continue
    const p: any = percheMie.get(r.id)
    const c = r.spedizione_id ? conti.get(r.spedizione_id) : undefined
    const gruppo = c?.senzaCliente ? 'senza' : p?.tipo === 'gia_fatta_pagare' ? 'gia' : p?.tipo === 'stesso_prezzo' ? 'uguale' : 'altre'
    const frase = gruppo === 'senza' ? SENZA
      : gruppo === 'gia' ? fraseGia(p.gia)
      : p?.tipo === 'reso' ? 'Reso: il ritorno si paga col nolo del reso, non con la ripesatura.'
      : p?.tipo === 'senza_voce' ? 'Il fornitore ha addebitato un importo senza dire per cosa (né chili né un supplemento conosciuto): il portale non sa a chi girarlo.'
      : descriviStessoPrezzo(p?.conto) + '.'
    righe.push({
      id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
      da: 'Tuo costo (contratto tuo)', importo: costo,
      recuperata: gruppo === 'gia' ? p.gia : null, gruppo, chi: c?.chi || null, frase,
      ...(conPoste && FERMA.has(r.controllo?.esito) ? { poste: r.controllo.motivo } : {}),
    })
  }
  righe.sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
  const somma = (rs: any[]) => arr(rs.reduce((t, r) => t + Number(r.importo || 0), 0))
  const gruppi: Record<string, { n: number; euro: number }> = {}
  for (const g of GRUPPI_NON_GIRATE) {
    const rs = righe.filter(r => r.gruppo === g)
    gruppi[g] = { n: rs.length, euro: somma(rs) }
  }
  return { righe, totale: somma(righe), gruppi }
}
