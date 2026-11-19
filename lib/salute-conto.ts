// LA SALUTE DEL CONTO (Lorenzo, 18-19/11/2026). Il master carica l'estratto conto e il portale gli dice:
// quanto ha, quanto deve dare, quanto deve avere, quanto guadagna davvero al mese togliendo le spese, e se
// va avanti cosi' dove arriva. Prima solo per Ecomize Solution (lib/contabilita-banca), poi per tutti.
//
// Il giro dei soldi di un master come Ecomize Solution (esempio di Lorenzo):
// - fa spedizioni a fattura con MULTI: il suo conto verso MULTI scende, la fattura la paga quando vuole
//   (un bonifico in uscita sull'estratto) e MULTI gli ricarica il conto di quei soldi;
// - vende a Ecomize LL e a Dg Express, anche loro a fattura: il loro conto verso di lui scende;
// - i clienti di LL e Dg pagano le ricariche sul conto in banca di Solution: sono soldi loro, ma LL e Dg
//   devono a Solution le spedizioni, quindi si compensano (il giro, lib/contabilita-estratti);
// - rettifiche e contrassegni fanno lo stesso giro: MULTI addebita o compensa subito, Solution ripassa ai
//   clienti dopo. In mezzo ci sono soldi gia' usciti o gia' entrati che sono di qualcun altro.
//
// LA POSIZIONE si fotografa al giorno dell'ultimo estratto caricato (la banca la sappiamo solo fin li'):
// tutti i saldi dei conti del portale si prendono A QUEL GIORNO, dal saldo_dopo dell'ultimo movimento
// (verificato il 19/11: saldo_dopo dell'ultimo movimento = credito di oggi su Solution, i 4 sotto-master
// e i 165 clienti, nessuna differenza). Mescolare la banca del 31/10 coi saldi di oggi conterebbe due volte
// ogni pagamento fatto nel frattempo.
//
// Prova sui dati veri di ottobre (19/11): posizione 30/09 = 20.824,76, 31/10 = 50.878,61, differenza
// 30.053,85 contro guadagno 17.978,34 meno spese 9.108,68 = 8.869,66. Lo scarto di 21.184 ha nome e
// cognome: 12.151,35 pagati dai clienti di Dg sul conto di Solution e mai girati a Dg (il debito di Dg li
// conta ancora), 6.396,59 + 1.700 entrati senza nessuna ricarica, 3.020 di ricariche di settembre pagate a
// ottobre. Per questo quelle voci qui sotto stanno fra le "attenzioni", con l'importo.
import { fetchAllStretto } from '@/lib/fetch-all'
import { sottoSulConto } from '@/lib/contabilita-banca'
import { voceUscita } from '@/lib/contabilita-abbina'
import { guadagnoOperativo } from '@/lib/guadagno-totale'
import { leggiCostiGestione, riepilogoCosti } from '@/lib/costi-gestione'

const GIORNO = 86400000
const r2 = (x: number) => Math.round(x * 100) / 100
const giornoRoma = (ts: string | number | Date) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
const spostaGiorni = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * GIORNO).toISOString().slice(0, 10)
const giorniFra = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / GIORNO)
/** L'ultimo istante di un giorno di Roma, in UTC (ora legale o solare). */
function fineGiornoRoma(g: string): string {
  const oraRoma = Number(new Date(g + 'T12:00:00Z').toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }))
  return new Date(Date.parse(g + 'T23:59:59.999Z') - (oraRoma - 12) * 3600000).toISOString()
}
const inizioGiornoRoma = (g: string) => new Date(Date.parse(fineGiornoRoma(spostaGiorni(g, -1))) + 1).toISOString()
const ultimoDelMese = (g: string) => { const [a, m] = g.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }

/** Il saldo di un conto a un istante: il saldo_dopo dell'ultimo movimento fino a li' (0 se non ce ne sono). */
async function saldoAl(admin: any, campo: 'cliente_id' | 'master_target_id', id: string, D: string, conto?: string): Promise<number> {
  let q = admin.from('movimenti').select('saldo_dopo').eq(campo, id).lte('created_at', D)
  if (conto) q = q.eq('conto', conto)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] ? Number(data[0].saldo_dopo) : 0
}
async function aBlocchi<T, R>(l: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < l.length; i += n) out.push(...await Promise.all(l.slice(i, i + n).map(f)))
  return out
}

type Figlio = { id: string, nome: string, saldo: number, trenta: number }
export type Riga = { etichetta: string, importo: number, nota?: string, dettaglio?: { nome: string, importo: number, nota?: string }[] }
export type Attenzione = { titolo: string, frase: string, importo?: number }

// ── LE USCITE DELLA BANCA: spese vere o soldi che passano ────────────────────────────────────────────────
// Pagare MULTI, girare i contrassegni ai clienti, rimborsare un cliente non sono spese: sono soldi che il
// portale conta gia' altrove (debito verso MULTI, contrassegni da girare, credito dei clienti). Spese sono
// la carta, il software, gli stipendi, le tasse. Il bonifico a MULTI si riconosce dalla ricarica che MULTI
// fa sul conto del master per lo stesso importo nei giorni dopo (Lorenzo: "la vedi come uscita dal suo
// estratto, e multi ricaricherà il conto di solution"); quello dei contrassegni dalla distinta pagata con
// un bonifico di quell'importo, o dalla causale.
const PASSAGGI = new Set(['Contrassegni pagati ai clienti', 'Rimborsi ai clienti'])
export async function usciteDellaBanca(admin: any, M: string, dal: string, al: string) {
  const [righe, voci, ricariche, distinte] = await Promise.all([
    fetchAllStretto(() => admin.from('estratti_righe').select('id,data,nome,causale,iban,importo').eq('master_id', M).gte('data', dal).lte('data', al).lt('importo', 0).order('data').order('id')),
    fetchAllStretto(() => admin.from('uscite_voci').select('controparte,voce').eq('master_id', M).order('controparte')),
    // le ricariche sul conto del master verso chi gli vende (conto 'rete'), qualche giorno piu' in la'
    fetchAllStretto(() => admin.from('movimenti').select('id,importo,created_at').eq('master_target_id', M).eq('conto', 'rete').eq('tipo', 'ricarica')
      .gte('created_at', inizioGiornoRoma(spostaGiorni(dal, -1))).lte('created_at', fineGiornoRoma(spostaGiorni(al, 6))).order('created_at').order('id')),
    fetchAllStretto(() => admin.from('distinte_contrassegni').select('id,metodo_pagamento,data_pagamento').eq('master_id', M)
      .gte('data_pagamento', inizioGiornoRoma(spostaGiorni(dal, -6))).lte('data_pagamento', fineGiornoRoma(spostaGiorni(al, 6))).order('id')),
  ])
  const personalizzate = new Map<string, string>(voci.map((v: any) => [v.controparte, v.voce]))
  const libereRic = ricariche.map((x: any) => ({ importo: r2(Number(x.importo)), giorno: giornoRoma(x.created_at), usata: false }))
  const libereCod = distinte.flatMap((d: any) => [...String(d.metodo_pagamento || '').matchAll(/bonifico €([\d.]+)/g)]
    .map(m => ({ importo: r2(Number(m[1])), giorno: giornoRoma(d.data_pagamento), usata: false })))
  const prendi = (l: { importo: number, giorno: string, usata: boolean }[], importo: number, data: string, prima: number, dopo: number) => {
    const x = l.find(y => !y.usata && Math.abs(y.importo - importo) < 0.005 && giorniFra(data, y.giorno) >= -prima && giorniFra(data, y.giorno) <= dopo)
    if (x) x.usata = true
    return !!x
  }
  const spese = new Map<string, { voce: string, n: number, totale: number }>()
  let passaggi = 0, aFornitore = 0, cod = 0
  for (const r of righe) {
    const importo = r2(-Number(r.importo))
    const voce = voceUscita(r, personalizzate)
    if (prendi(libereRic, importo, r.data, 1, 5)) { aFornitore = r2(aFornitore + importo); continue }
    if (voce === 'Contrassegni pagati ai clienti' || prendi(libereCod, importo, r.data, 5, 5)) { cod = r2(cod + importo); continue }
    if (PASSAGGI.has(voce)) { passaggi = r2(passaggi + importo); continue }
    const s = spese.get(voce) || { voce, n: 0, totale: 0 }
    s.n++; s.totale = r2(s.totale + importo); spese.set(voce, s)
  }
  const elenco = [...spese.values()].sort((a, b) => b.totale - a.totale)
  return { spese: elenco, totaleSpese: r2(elenco.reduce((t, x) => t + x.totale, 0)), aFornitore, contrassegni: cod, altriPassaggi: passaggi }
}

// ── LA POSIZIONE A UN GIORNO ─────────────────────────────────────────────────────────────────────────────
async function posizioneAl(admin: any, M: string, giorno: string, coperturaDal: string) {
  const D = fineGiornoRoma(giorno)
  const [{ data: io, error: e0 }, { data: figli, error: e1 }, clienti, conti] = await Promise.all([
    admin.from('masters').select('parent_master_id').eq('id', M).single(),
    admin.from('masters').select('id,nome').eq('parent_master_id', M).order('nome'),
    fetchAllStretto(() => admin.from('clienti').select('id,ragione_sociale').eq('master_id', M).order('id')),
    sottoSulConto(admin, M),
  ])
  if (e0) throw new Error(e0.message)
  if (e1) throw new Error(e1.message)
  const { data: padre } = io.parent_master_id ? await admin.from('masters').select('nome').eq('id', io.parent_master_id).maybeSingle() : { data: null }
  const nomePadre = padre?.nome || 'chi ti vende le spedizioni'

  // I saldi di tutti, a quel giorno. Il conto 'rete' e' quello verso il padre (le spedizioni a fattura).
  const [suo, saldiFigli, saldiFigliPrima, saldiClienti] = await Promise.all([
    saldoAl(admin, 'master_target_id', M, D, 'rete'),
    aBlocchi(figli || [], 10, (f: any) => saldoAl(admin, 'master_target_id', f.id, D, 'rete')),
    aBlocchi(figli || [], 10, (f: any) => saldoAl(admin, 'master_target_id', f.id, fineGiornoRoma(spostaGiorni(giorno, -30)), 'rete')),
    aBlocchi(clienti, 40, (c: any) => saldoAl(admin, 'cliente_id', c.id, D)),
  ])

  // Contrassegni da girare: quelli che il padre gli ha pagato (anche compensati sul conto) meno quelli che lui
  // ha pagato ai suoi clienti e sotto-master, fino a quel giorno. Le distinte tengono la data del pagamento.
  const [codIn, codOut] = await Promise.all([
    fetchAllStretto(() => admin.from('distinte_contrassegni').select('id,totale_pagato,data_pagamento').eq('target_master_id', M).not('data_pagamento', 'is', null).lte('data_pagamento', D).order('id')),
    fetchAllStretto(() => admin.from('distinte_contrassegni').select('id,totale_pagato,data_pagamento').eq('master_id', M).not('data_pagamento', 'is', null).lte('data_pagamento', D).order('id')),
  ])
  const codDaGirare = r2(codIn.reduce((t: number, x: any) => t + Number(x.totale_pagato || 0), 0) - codOut.reduce((t: number, x: any) => t + Number(x.totale_pagato || 0), 0))

  // Bonifici, ricariche e giri sul periodo coperto dalla banca.
  const reteIds = [M, ...conti.map(x => x.id)]
  const [righe, ricariche, abbinamenti, parti, giri] = await Promise.all([
    fetchAllStretto(() => admin.from('estratti_righe').select('id,data,importo,target_id,assegnato').eq('master_id', M).gte('data', coperturaDal).lte('data', giorno).gt('importo', 0).order('data').order('id')),
    fetchAllStretto(() => admin.from('ricariche_check').select('id,master_id,target_tipo,target_id,target_nome,importo,ricaricato_il,metodo,nascosta_il,a_mano')
      .in('master_id', reteIds).lte('ricaricato_il', D).or(`ricaricato_il.gte."${inizioGiornoRoma(spostaGiorni(coperturaDal, -15))}",a_mano.eq.true`).order('ricaricato_il').order('id')),
    fetchAllStretto(() => admin.from('abbinamenti_bonifici').select('ricarica_id,riga_id').eq('master_id', M).order('id')),
    fetchAllStretto(() => admin.from('parti_bonifici').select('ricarica_id,riga_id,importo').eq('master_id', M).order('id')).catch(() => []),
    leggiGiri(admin, M),
  ])
  const dataRiga = new Map<string, string>(righe.map((r: any) => [r.id, r.data]))
  const pagataIl = new Map<string, string>()   // ricarica → giorno del bonifico che la paga (fino a quel giorno)
  for (const a of abbinamenti) { const d = dataRiga.get(a.riga_id); if (d) pagataIl.set(a.ricarica_id, d) }
  const pagatoParti = new Map<string, number>()
  for (const p of parti) { if (dataRiga.has(p.riga_id) && !pagataIl.has(p.ricarica_id)) pagatoParti.set(p.ricarica_id, r2((pagatoParti.get(p.ricarica_id) || 0) + Number(p.importo))) }

  // Ricariche fatte dal master e non ancora arrivate in banca. Solo dove la banca c'e' (prima del primo estratto
  // non si puo' sapere) o aggiunte a mano apposta perche' le aspetta. Non quelle ai sotto-master del conto
  // condiviso: quelle sono il giro, non aspettano un bonifico. Le nascoste le ha tolte lui dal Check Ricariche.
  const sottoConto = new Set(conti.map(x => x.id))
  const nonArrivate = ricariche.filter((r: any) => r.master_id === M && !r.nascosta_il && (!r.metodo || r.metodo === 'bonifico')
    && !(r.target_tipo === 'master' && sottoConto.has(r.target_id)) && !pagataIl.has(r.id)
    && (r.a_mano || giornoRoma(r.ricaricato_il) >= coperturaDal))
    .map((r: any) => ({ nome: r.target_nome || '—', importo: r2(Number(r.importo) - (pagatoParti.get(r.id) || 0)), giorno: giornoRoma(r.ricaricato_il) }))
    .filter((x: any) => x.importo > 0)

  // Il giro ai sotto-master del conto condiviso: i bonifici dei loro clienti arrivati dal giorno del giro e non
  // ancora girati a quel giorno. Prima del giorno del giro si girava a mano: quello lo dicono le attenzioni.
  const girata = new Set(giri.righe.filter((g: any) => g.creato_il <= D && (!g.annullato_il || g.annullato_il > D)).map((g: any) => g.ricarica_id))
  const perSotto = new Map<string, { daGirare: number, primaDelGiro: number }>()
  for (const r of ricariche) {
    if (!sottoConto.has(r.master_id)) continue
    const d = pagataIl.get(r.id); if (!d) continue
    const s = conti.find(x => x.id === r.master_id)!
    const v = perSotto.get(s.id) || { daGirare: 0, primaDelGiro: 0 }
    if (d >= s.giroDal) { if (!girata.has(r.id)) v.daGirare = r2(v.daGirare + Number(r.importo)) }
    else v.primaDelGiro = r2(v.primaDelGiro + Number(r.importo))
    perSotto.set(s.id, v)
  }

  // Rettifiche in sospeso a quel giorno: da passare ai propri (soldi da avere) e in arrivo dal padre (da dare).
  const rett = await rettificheInSospeso(admin, M, D, clienti.map((c: any) => c.id), (figli || []).map((f: any) => f.id))

  // Entrate in banca che non pagano nessuna ricarica: se sono ricariche ancora da fare sono soldi dei clienti.
  const usate = new Set([...abbinamenti.map((a: any) => a.riga_id), ...parti.map((p: any) => p.riga_id)])
  const senzaRicarica = righe.filter((r: any) => !usate.has(r.id) && r.assegnato !== 'escluso')
  const totSenza = r2(senzaRicarica.reduce((t: number, r: any) => t + Number(r.importo), 0))

  const figliRighe: Figlio[] = (figli || []).map((f: any, i: number) => ({ id: f.id, nome: f.nome, saldo: r2(saldiFigli[i]), trenta: r2(saldiFigli[i] - saldiFigliPrima[i]) }))
  const clientiRighe: { nome: string, saldo: number }[] = clienti.map((c: any, i: number) => ({ nome: c.ragione_sociale || '—', saldo: r2(saldiClienti[i]) }))
  return { giorno, nomePadre, suo: r2(suo), figli: figliRighe, clienti: clientiRighe, codDaGirare, nonArrivate, perSotto, rett,
    senzaRicarica: { n: senzaRicarica.length, totale: totSenza }, conti }
}

async function leggiGiri(admin: any, M: string) {
  const { data: g, error } = await admin.from('giri_bonifici').select('id,sotto_master_id,importo,creato_il,annullato_il').eq('master_id', M)
  if (error) { if (/giri_bonifici/.test(error.message) && /does not exist|schema cache/i.test(error.message)) return { giri: [], righe: [] }; throw new Error(error.message) }
  const ids = (g || []).map((x: any) => x.id)
  const righe: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e2 } = await admin.from('giri_bonifici_ricariche').select('giro_id,ricarica_id').in('giro_id', ids.slice(i, i + 200))
    if (e2) throw new Error(e2.message)
    righe.push(...(data || []))
  }
  const di = new Map((g || []).map((x: any) => [x.id, x]))
  return { giri: g || [], righe: righe.map(x => ({ ...x, creato_il: (di.get(x.giro_id) as any).creato_il, annullato_il: (di.get(x.giro_id) as any).annullato_il })) }
}

async function rettificheInSospeso(admin: any, M: string, D: string, clienti: string[], figli: string[]) {
  const dal = new Date(Date.parse(D) - 90 * GIORNO).toISOString()   // una rettifica ferma da piu' di 3 mesi non e' piu' in sospeso
  const campi = 'id,differenza,stato,created_at,confermata_il,master_id'
  const leggi = (campo: string, ids: string[]) => aBlocchi(Array.from({ length: Math.ceil(ids.length / 60) }, (_, i) => ids.slice(i * 60, i * 60 + 60)), 4,
    async (pezzo: string[]) => fetchAllStretto(() => admin.from('rettifiche').select(campi).in(campo, pezzo).gte('created_at', dal).lte('created_at', D)
      .or(`stato.eq.da_rettificare,stato.eq.in_contestazione,confermata_il.gt."${D}"`).order('id')))
  const [giuC, giuF, su] = await Promise.all([leggi('cliente_id', clienti), leggi('target_master_id', figli), leggi('target_master_id', [M])])
  const inSospesoAl = (r: any) => r.stato === 'da_rettificare' || (r.stato === 'confermata' && r.confermata_il && r.confermata_il > D)
  const somma = (l: any[]) => r2(-l.reduce((t, r) => t + Number(r.differenza || 0), 0))
  const giu = [...giuC.flat(), ...giuF.flat()].filter((r: any) => r.master_id === M)
  const daPadre = su.flat().filter((r: any) => r.master_id !== M)
  return {
    daPassare: somma(giu.filter(inSospesoAl)), nDaPassare: giu.filter(inSospesoAl).length,
    inContestazione: somma(giu.filter((r: any) => r.stato === 'in_contestazione')),
    inArrivo: somma(daPadre.filter(inSospesoAl)),
  }
}

// ── TUTTO INSIEME ────────────────────────────────────────────────────────────────────────────────────────
export async function saluteConto(admin: any, M: string, adesso = new Date()) {
  const { data: estratti, error } = await admin.from('estratti_conto').select('dal,al,saldo_finale,caricato_il').eq('master_id', M).order('al', { ascending: false })
  if (error) throw new Error(error.message)
  if (!estratti?.length) return { senzaEstratto: true as const }
  const ultimo = estratti[0]
  const giornoBanca = String(ultimo.al).slice(0, 10)
  const coperturaDal = estratti.map((e: any) => String(e.dal).slice(0, 10)).sort()[0]
  const oggi = giornoRoma(adesso)
  const banca = r2(Number(ultimo.saldo_finale))

  const mesiDa = [...new Set(Array.from({ length: 4 }, (_, i) => { const d = new Date(Date.UTC(+oggi.slice(0, 4), +oggi.slice(5, 7) - 1 - (3 - i), 1)); return d.toISOString().slice(0, 7) }))]
  // Le letture sono indipendenti: tutte insieme (da sole in fila ci mettevano 13 secondi su Solution).
  const [p, voci, guadagniMesi, usciteMesi, ultimi30, dopoBanca] = await Promise.all([
    posizioneAl(admin, M, giornoBanca, coperturaDal),
    leggiCostiGestione(admin, M, mesiDa[0] + '-01', oggi).catch(() => []),
    Promise.all(mesiDa.map(m => { const dal = m + '-01', fine = ultimoDelMese(dal), al = fine < oggi ? fine : oggi
      return guadagnoOperativo(admin, M, dal + 'T00:00:00.000Z', al + 'T23:59:59.999Z') })),
    Promise.all(mesiDa.map(m => { const dal = m + '-01', fine = ultimoDelMese(dal), al = fine < oggi ? fine : oggi
      const da = dal < coperturaDal ? coperturaDal : dal, a = al < giornoBanca ? al : giornoBanca
      return da <= a ? usciteDellaBanca(admin, M, da, a) : Promise.resolve(null) })),
    guadagnoOperativo(admin, M, spostaGiorni(oggi, -30) + 'T00:00:00.000Z', spostaGiorni(oggi, -1) + 'T23:59:59.999Z'),
    giornoBanca < oggi ? guadagnoOperativo(admin, M, spostaGiorni(giornoBanca, 1) + 'T00:00:00.000Z', adesso.toISOString()) : Promise.resolve({ guadagno: 0 }),
  ])

  // ── la posizione: quello che ha, quello che deve dare, quello che deve avere ──
  const hai: Riga[] = [{ etichetta: 'In banca', importo: banca, nota: `saldo dell'estratto al ${it(giornoBanca)}` }]
  const devi: Riga[] = []
  const devonoA: Riga[] = []
  if (p.suo >= 0) hai.push({ etichetta: `Credito sul conto verso ${p.nomePadre}`, importo: p.suo, nota: 'soldi già versati e non ancora spesi in spedizioni' })
  else devi.push({ etichetta: `Spedizioni da pagare a ${p.nomePadre}`, importo: r2(-p.suo), nota: 'il tuo conto verso di lui: lo paghi quando vuoi, poi lui te lo ricarica' })

  const debitori = p.figli.filter(f => f.saldo < 0)
  if (debitori.length) devonoA.push({ etichetta: 'I tuoi sotto-master', importo: r2(-debitori.reduce((t, f) => t + f.saldo, 0)),
    dettaglio: debitori.sort((a, b) => a.saldo - b.saldo).map(f => ({ nome: f.nome, importo: r2(-f.saldo),
      nota: f.trenta < 0 ? `+${eur(-f.trenta)} negli ultimi 30 giorni` : f.trenta > 0 ? `${eur(f.trenta)} rientrati negli ultimi 30 giorni` : undefined })) })
  const clientiNeg = p.clienti.filter(c => c.saldo < 0)
  if (clientiNeg.length) devonoA.push({ etichetta: 'Clienti col conto in rosso', importo: r2(-clientiNeg.reduce((t, c) => t + c.saldo, 0)),
    dettaglio: clientiNeg.sort((a, b) => a.saldo - b.saldo).slice(0, 8).map(c => ({ nome: c.nome, importo: r2(-c.saldo) })) })
  if (p.nonArrivate.length) devonoA.push({ etichetta: 'Ricariche fatte e non ancora pagate', importo: r2(p.nonArrivate.reduce((t, x) => t + x.importo, 0)),
    nota: `${p.nonArrivate.length} ${p.nonArrivate.length === 1 ? 'ricarica' : 'ricariche'} senza bonifico in banca al ${it(giornoBanca)}`,
    dettaglio: p.nonArrivate.sort((a, b) => b.importo - a.importo).slice(0, 8).map(x => ({ nome: x.nome, importo: x.importo, nota: `del ${it(x.giorno)}` })) })
  if (p.rett.daPassare > 0) devonoA.push({ etichetta: 'Rettifiche ancora da passare ai tuoi', importo: p.rett.daPassare, nota: `${p.rett.nDaPassare} rettifiche: ${p.nomePadre} te le ha già addebitate, tu non ancora` })

  const prepagati = [...p.clienti.filter(c => c.saldo > 0), ...p.figli.filter(f => f.saldo > 0).map(f => ({ nome: f.nome, saldo: f.saldo }))]
  if (prepagati.length) devi.push({ etichetta: 'Credito dei tuoi clienti e sotto-master', importo: r2(prepagati.reduce((t, c) => t + c.saldo, 0)),
    nota: 'soldi che ti hanno già dato e non hanno ancora speso: sono loro', dettaglio: prepagati.sort((a, b) => b.saldo - a.saldo).slice(0, 8).map(c => ({ nome: c.nome, importo: r2(c.saldo) })) })
  if (p.codDaGirare > 0) devi.push({ etichetta: 'Contrassegni da girare', importo: p.codDaGirare, nota: `incassati da ${p.nomePadre} e non ancora pagati ai tuoi clienti` })
  else if (p.codDaGirare < 0) devonoA.push({ etichetta: 'Contrassegni anticipati', importo: r2(-p.codDaGirare), nota: `pagati ai tuoi clienti prima che ${p.nomePadre} li pagasse a te` })
  const giro = [...p.perSotto].filter(([, v]) => v.daGirare > 0)
  if (giro.length) devi.push({ etichetta: 'Bonifici dei clienti dei sotto-master da girare', importo: r2(giro.reduce((t, [, v]) => t + v.daGirare, 0)),
    nota: 'arrivati sul tuo conto, sono loro: abbassano quello che ti devono', dettaglio: giro.map(([id, v]) => ({ nome: p.conti.find(x => x.id === id)!.nome, importo: v.daGirare })) })
  if (p.rett.inArrivo > 0) devi.push({ etichetta: `Rettifiche in arrivo da ${p.nomePadre}`, importo: p.rett.inArrivo })

  const tot = (l: Riga[]) => r2(l.reduce((t, x) => t + x.importo, 0))
  const posizione = r2(tot(hai) + tot(devonoA) - tot(devi))
  // Liquidita': i soldi veri, senza contare quello che devono gli altri. Se e' sotto zero il master va avanti
  // coi soldi dei clienti (contrassegni e credito non speso).
  const liquidita = r2(tot(hai) - tot(devi))

  // ── l'andamento: guadagno meno spese, mese per mese ──
  const mesi = mesiDa.map((m, i) => {
    const dal = m + '-01', fine = ultimoDelMese(dal), al = fine < oggi ? fine : oggi
    const coperto = coperturaDal <= dal && giornoBanca >= fine
    const u = usciteMesi[i]
    return { mese: m, dal, al, completo: al === fine, guadagno: guadagniMesi[i].guadagno, banca: coperto ? 'completa' : u ? 'parziale' : 'assente',
      spese: u?.totaleSpese ?? null, voci: u?.spese || [], gestione: riepilogoCosti(voci, dal, al).totale }
  })

  // Costo al giorno per il futuro: i costi di gestione se li ha segnati (Lorenzo: il futuro dai Costi di
  // gestione), se no la media delle spese dei mesi con la banca completa, dicendolo.
  const conBanca = mesi.filter(m => m.banca === 'completa' && m.spese !== null)
  const costoMeseGestione = riepilogoCosti(voci, spostaGiorni(oggi, 1), spostaGiorni(oggi, 30)).totale
  const fonteCosti = costoMeseGestione > 0 ? 'gestione' : conBanca.length ? 'banca' : 'nessuna'
  const costoGiorno = fonteCosti === 'gestione' ? costoMeseGestione / 30
    : fonteCosti === 'banca' ? conBanca.reduce((t, m) => t + (m.spese || 0), 0) / conBanca.reduce((t, m) => t + giorniFra(m.dal, m.al) + 1, 0) : 0
  const guadagnoGiorno = ultimi30.guadagno / 30
  const giorniDopo = Math.max(0, giorniFra(giornoBanca, oggi))
  const stimaOggi = r2(posizione + dopoBanca.guadagno - costoGiorno * giorniDopo)
  const giorniAFine = giorniFra(oggi, ultimoDelMese(oggi))
  const alMese = r2((guadagnoGiorno - costoGiorno) * 30)
  const stima = { oggi: stimaOggi, fineMese: r2(stimaOggi + (guadagnoGiorno - costoGiorno) * giorniAFine), treMesi: r2(stimaOggi + (guadagnoGiorno - costoGiorno) * 90),
    guadagnoMese: r2(guadagnoGiorno * 30), costiMese: r2(costoGiorno * 30), alMese, fonteCosti, guadagnoDopoBanca: r2(dopoBanca.guadagno), giorniDopo }

  // ── il giudizio (Lorenzo 19/11, ok alla proposta): sana se la posizione e' sopra zero e il mese chiude in
  // utile; a rischio se tutte e due sono sotto; media se una sola. Con la frase su quanto dura. ──
  const posOk = stimaOggi > 0, meseOk = alMese > 0
  const livello = posOk && meseOk ? 'sana' : !posOk && !meseOk ? 'rischio' : 'media'
  const frase = livello === 'sana' ? `Sei sopra di ${eur(stimaOggi)} e ogni mese metti da parte circa ${eur(alMese)}.`
    : posOk ? `Sei sopra di ${eur(stimaOggi)}, ma ogni mese perdi circa ${eur(-alMese)}: a questo ritmo finisci a zero fra ${mesiFra(stimaOggi, -alMese)}.`
    : meseOk ? `Sei sotto di ${eur(-stimaOggi)}, ma ogni mese recuperi circa ${eur(alMese)}: torni sopra zero fra ${mesiFra(-stimaOggi, alMese)}.`
    : `Sei sotto di ${eur(-stimaOggi)} e ogni mese perdi altri ${eur(-alMese)}: se continua così il buco cresce.`

  // ── le attenzioni: quello che rende i numeri meno sicuri, con l'importo ──
  const attenzioni: Attenzione[] = []
  if (giorniDopo > 3) attenzioni.push({ titolo: `La banca è ferma al ${it(giornoBanca)}`, frase: `Sono ${giorniDopo} giorni: da allora il guadagno lo conta il portale, le spese le stimo. Carica l'estratto fino a ieri per un quadro vero.` })
  // Prima del giorno del giro i bonifici dei clienti dei sotto-master si giravano a mano: se quello che e' arrivato
  // in banca supera quello che gli e' stato ricaricato, la differenza e' ancora nella sua colonna "ti deve".
  for (const [id, v] of p.perSotto) {
    const s = p.conti.find(x => x.id === id)!
    if (v.primaDelGiro <= 0) continue
    const fine = giornoBanca < s.giroDal ? fineGiornoRoma(giornoBanca) : new Date(Date.parse(inizioGiornoRoma(s.giroDal)) - 1).toISOString()
    const girati = await ricaricheASotto(admin, M, s.id, inizioGiornoRoma(coperturaDal), fine, false)
    const manca = r2(v.primaDelGiro - girati)
    if (manca > 0) attenzioni.push({ titolo: `${s.nome}: bonifici dei suoi clienti mai girati`, importo: manca,
      frase: `Dal ${it(coperturaDal)} al ${it(s.giroDal < giornoBanca ? spostaGiorni(s.giroDal, -1) : giornoBanca)} i suoi clienti ti hanno pagato ${eur(v.primaDelGiro)} sul tuo conto e a ${s.nome} hai ricaricato a mano ${eur(girati)}. Se non glieli hai dati in un altro modo, ${s.nome} ti deve ${eur(manca)} meno di quanto dice il suo conto: quei soldi sono già nella tua banca.` })
  }
  const aMano = await Promise.all(p.conti.filter(s => s.giroDal <= giornoBanca).map(async s => ({ nome: s.nome, giroDal: s.giroDal,
    importo: await ricaricheASotto(admin, M, s.id, inizioGiornoRoma(s.giroDal), fineGiornoRoma(giornoBanca), false) }))).then(l => l.filter(x => x.importo > 0))
  for (const x of aMano) attenzioni.push({ titolo: `Ricariche a mano a ${x.nome} dal ${it(x.giroDal)}`, importo: x.importo,
    frase: `Il giro col pulsante dell'estratto è già acceso: se queste ricariche erano per i bonifici dei suoi clienti e premi anche il pulsante, li paghi due volte.` })
  if (p.senzaRicarica.totale > 0) attenzioni.push({ titolo: 'Soldi entrati che non pagano nessuna ricarica', importo: p.senzaRicarica.totale,
    frase: `${p.senzaRicarica.n} bonifici sull'estratto senza una ricarica che torni. Se sono ricariche ancora da fare, quei soldi sono dei clienti e la posizione è più bassa di così.` })
  if (p.rett.inContestazione > 0) attenzioni.push({ titolo: 'Rettifiche in contestazione', importo: p.rett.inContestazione, frase: 'Non le conto: dipende da come finisce.' })
  if (fonteCosti !== 'gestione') attenzioni.push({ titolo: 'Nessun costo di gestione segnato', frase: fonteCosti === 'banca'
    ? `Per il futuro uso la media delle spese uscite dalla banca (${eur(costoGiorno * 30)} al mese). Affitto, collaboratori, mezzi pagati da altri conti o in contanti mancano: segnali in Costi di gestione.`
    : 'Senza costi segnati e senza un mese intero di banca il futuro non ha spese: segnale in Costi di gestione.' })
  const grande = debitori.sort((a, b) => a.saldo - b.saldo)[0]
  if (liquidita < 0) attenzioni.unshift({ titolo: 'I soldi che hai non coprono quelli dei clienti', importo: r2(-liquidita),
    frase: `Banca e credito verso ${p.nomePadre} fanno ${eur(tot(hai))}, ma ${eur(tot(devi))} sono soldi da dare: credito non speso dei clienti, contrassegni da girare, ${p.nomePadre}. Ti mancano ${eur(-liquidita)}: stai andando avanti anche coi soldi dei clienti.` })
  if (grande && posizione > 0 && -grande.saldo > posizione * 0.5) attenzioni.splice(liquidita < 0 ? 1 : 0, 0, { titolo: `Quasi tutta la posizione è quello che ti deve ${grande.nome}`, importo: r2(-grande.saldo),
    frase: grande.trenta < 0 ? `E negli ultimi 30 giorni il suo debito è salito di ${eur(-grande.trenta)}. Se non paga, la posizione vera è ${eur(r2(posizione + grande.saldo))}.` : `Se non paga, la posizione vera è ${eur(r2(posizione + grande.saldo))}.` })

  return {
    senzaEstratto: false as const, oggi, banca: { giorno: giornoBanca, saldo: banca, coperturaDal, giorniFa: giorniDopo },
    posizione: { giorno: giornoBanca, hai, devonoA, devi, totale: posizione, liquidita }, stima,
    giudizio: { livello, frase }, mesi, attenzioni, padre: p.nomePadre,
  }
}

/** Le ricariche del master a un sotto-master in un intervallo. Il pulsante del giro scrive la sua con riferimento
 *  'giro <id>' (gira_bonifici_sotto_master): `colPulsante` false = solo quelle a mano. */
async function ricaricheASotto(admin: any, M: string, sotto: string, dal: string, al: string, colPulsante: boolean) {
  const l = await fetchAllStretto(() => admin.from('movimenti').select('id,importo,riferimento').eq('master_target_id', sotto).eq('conto', 'rete').eq('tipo', 'ricarica')
    .eq('master_id', M).gte('created_at', dal).lte('created_at', al).order('id'))
  return r2(l.filter((x: any) => colPulsante || !String(x.riferimento || '').startsWith('giro ')).reduce((t: number, x: any) => t + Number(x.importo), 0))
}

// Il punto delle migliaia anche sotto 10.000 (8.814,85, non 8814,85) e il meno davanti: sono soldi, si leggono di corsa.
function eur(n: number) { const v = Number(n || 0); return `${v < 0 ? '−' : ''}€ ${Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as any)}` }
function it(g: string) { return g.split('-').reverse().join('/') }
function mesiFra(quanto: number, alMese: number) {
  const m = quanto / alMese
  return m < 1 ? `${Math.max(1, Math.round(m * 30))} giorni` : m < 24 ? `${Math.round(m)} ${Math.round(m) === 1 ? 'mese' : 'mesi'}` : 'più di due anni'
}
