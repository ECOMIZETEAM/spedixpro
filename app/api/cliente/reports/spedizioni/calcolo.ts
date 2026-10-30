import { fetchAllStretto } from '@/lib/fetch-all'
import { SPED_COLS_CLIENTE } from '@/lib/spedizioni-cols'
import { marchioCorriere } from '@/lib/corriere-logo'
import { leggiPerBlocchi, pagatoSuAnnullate } from '../comune'

export type FiltriSpedizioniCliente = {
  dal: string | null; al: string | null; stato?: string | null; contrassegno?: string | null
  provincia?: string | null; vettore?: string | null
}

// Le spedizioni del report del cliente, complete (a pagine: PostgREST tronca a 1.000 per richiesta).
//
// IMPORTO DELLE ANNULLATE = quello rimasto pagato, cioe' 0. `costo_totale` resta valorizzato anche
// dopo l'annullo, e il report lo sommava: sui clienti col portale, negli ultimi 30 giorni al
// 15/10/2026, 3.378 annullate valevano 27.453,48 € nel file contro 65,25 € davvero rimasti addebitati;
// NS CONSULTING leggeva 16.301,10 invece di 14.465,60. L'annullata e' stata rimborsata (movimento
// 'rimborso'), quindi la riga resta — lo storico non si nasconde — con stato "Annullata" e importo 0,
// fuori dai totali. Fanno eccezione i pacchi annullati e poi ri-addebitati perche' partiti: valgono
// quello che il cliente ha pagato (vedi pagatoSuAnnullate). Le spedizioni ancora in annullamento
// (annullamento_pending, annullamento_manuale, storno_richiesto) restano col loro importo: il
// rimborso non e' ancora avvenuto.
// L'importo si decide QUI, una volta, cosi' PDF, Excel, CSV e ZIP leggono tutti lo stesso numero.
export async function spedizioniReportCliente(db: any, clienteId: string, f: FiltriSpedizioniCliente) {
  const spedizioni = await fetchAllStretto<any>(() => {
    let q = db.from('spedizioni')
      // MAI select('*') su una tabella che il cliente legge: mandava al browser anche
      // costo_spedizione (il costo del MASTER, quindi il suo guadagno), raw_response (dati del
      // provider) e etichetta_url (154 kB di PDF per riga). La pagina non li mostrava, ma
      // bastava aprire gli strumenti per sviluppatori.
      // corrieri(nome_contratto) serve alle colonne Corriere/Contratto e al filtro Vettore. NON esce
      // mai il costo del master: SPED_COLS_CLIENTE toglie costo_spedizione, e non si joina niente che
      // riveli il provider (nome_contratto e' il brand).
      .select(`${SPED_COLS_CLIENTE}, clienti(ragione_sociale), corrieri(nome_contratto)`)
      .eq('cliente_id', clienteId)
    if (f.stato) q = q.eq('stato', f.stato)
    if (f.dal) q = q.gte('created_at', f.dal)
    if (f.al) q = q.lte('created_at', f.al)
    if (f.contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (f.contrassegno === 'no') q = q.eq('contrassegno', 0)
    // Senza maiuscole/minuscole: 2.670 spedizioni dell'anno hanno la provincia non tutta maiuscola
    // ("na") e col confronto esatto sparivano dal filtro.
    if (f.provincia) q = q.ilike('dest_provincia', f.provincia.replace(/[%_\\]/g, ''))
    return q.order('created_at', { ascending: false }).order('id', { ascending: false })
  })

  // Vettore = MARCHIO pubblico del contratto, lo stesso che il file scrive nella colonna Corriere.
  const filtrate = f.vettore
    ? spedizioni.filter((s: any) => marchioCorriere(s.corrieri?.nome_contratto || '') === f.vettore)
    : spedizioni

  // DATA CONSEGNA: data_evento piu' recente per le CONSEGNATE. Prima i blocchi da 300 spedizioni si
  // leggevano senza pagine: con una decina di eventi a pacco il blocco superava le 1.000 righe e le
  // date delle ultime spedizioni restavano vuote. Regole del cliente: solo gli eventi dei suoi pacchi.
  const consegnaMap = new Map<string, string>()
  const consegnate = filtrate
    .filter((s: any) => /conseg/i.test(s.stato || '') && !/in[\s_]?conseg/i.test(s.stato || ''))
    .map((s: any) => s.id)
  const eventi = await leggiPerBlocchi<any>(consegnate, (b) => db.from('tracking_events')
    .select('id,spedizione_id,data_evento').in('spedizione_id', b).order('spedizione_id', { ascending: true }).order('id', { ascending: true }))
  for (const e of eventi) {
    const d = e.data_evento; if (!d) continue
    const prima = consegnaMap.get(e.spedizione_id)
    if (!prima || d > prima) consegnaMap.set(e.spedizione_id, d)
  }

  // DISTINTA (data + bordero) per Data_distinta/bda: nessuna FK spedizioni->distinte, niente embed
  // (che vuoterebbe il report): lookup in blocco per distinta_id. Il cliente legge solo le proprie.
  const distMap = new Map<string, any>()
  const distIds = Array.from(new Set(filtrate.map((s: any) => s.distinta_id).filter(Boolean))) as string[]
  const distinte = await leggiPerBlocchi<any>(distIds, (b) => db.from('distinte')
    .select('id,data,bordero_id').in('id', b).order('id', { ascending: true }))
  for (const d of distinte) distMap.set(d.id, { data: d.data, bordero_id: d.bordero_id })

  const pagato = await pagatoSuAnnullate(db, clienteId,
    filtrate.filter((s: any) => s.stato === 'annullata').map((s: any) => s.id))

  return filtrate.map((s: any) => ({
    ...s,
    costo_totale: s.stato === 'annullata' ? (pagato.get(s.id) || 0) : Number(s.costo_totale || 0),
    data_consegna: consegnaMap.get(s.id) || null,
    distinte: distMap.get(s.distinta_id) || null,
  }))
}
