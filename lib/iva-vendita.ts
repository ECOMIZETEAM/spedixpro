// COME HO VENDUTO UNA SPEDIZIONE: IVA INCLUSA O ESCLUSA (Lorenzo, 20/11/2026).
//
// La regola NON sta qui: sta nel database, in fn_iva_vendita (scripts/iva-listini.sql). Qui ci sono
// solo le chiamate, a blocchi, per i report. Una regola che decide come si legge un prezzo non si
// riscrive in ogni report: la chiedono tutti allo stesso posto.
//
// Chi chiede: il VENDITORE (il master che ha venduto) e, per ogni riga, il COMPRATORE (un suo cliente
// o il sotto-master di prima linea) con la spedizione. Il database guarda quale listino aveva il
// compratore il giorno della spedizione, e come era venduto su quel listino il contratto del venditore
// in quel giorno. I movimenti non c'entrano: il credito ha scalato il prezzo del listino comunque.

import type { InfoIvaPrezzi, RegimeIva } from '@/lib/iva-calcolo'

export type ChiestaIva = {
  t: 'cliente' | 'master'   // chi ha comprato
  s: string                 // il suo id
  p: string                 // la spedizione
  m?: string                // tipo di movimento (spedizione, rettifica, giacenza, reso, rimborso)
}

// Il database risponde al massimo 1.000 righe per chiamata: blocchi da 1.000, e se ne tornano meno
// di quante ne ho chieste la richiesta fallisce. Un report con mezze righe "IVA esclusa" per sbaglio
// sarebbe peggio di un errore.
const BLOCCO = 1000

// La tabella nasce con scripts/iva-listini.sql. Finche' non c'e', nessuno ha scelto IVA inclusa:
// tutto e' IVA esclusa, come prima. Qualunque altro errore ferma il report.
const TABELLA_ASSENTE = new Set(['42P01', 'PGRST205', 'PGRST202'])

export async function venditoreUsaIva(admin: any, venditore: string | null | undefined): Promise<boolean> {
  if (!venditore) return false
  const { data, error } = await admin.from('listini_iva').select('id').eq('master_id', venditore).limit(1)
  if (error) {
    if (TABELLA_ASSENTE.has(String(error.code || ''))) return false
    throw new Error('Impostazioni IVA dei listini non leggibili: ' + error.message)
  }
  return !!data?.length
}

// COME E' VENDUTO OGGI UN LISTINO, per l'editor e per le etichette: la scelta del listino e quella di ogni
// contratto impostato a parte (null = "come il listino"). Vale l'ultima scelta fatta, come in
// fn_iva_regime_al: le scelte partono sempre da oggi o da inizio mese, quindi l'ultima fatta e' quella in
// vigore adesso. `listino` null = IL MASTER NON HA ANCORA SCELTO (decisione di Lorenzo, 20/11/2026: finche'
// non sceglie, i suoi clienti vedono i prezzi come prima; i report restano IVA esclusa come sempre).
// Esente (21/11/2026) = iva_inclusa false + iva_esente true (scripts/iva-esente.sql).
export type StatoIvaListino = { listino: RegimeIva | null; corrieri: Record<string, RegimeIva | null> }

// Una riga di scelta: null = "come il listino" (solo sui contratti).
const regimeRiga = (r: any): RegimeIva | null =>
  r.iva_inclusa == null ? null : r.iva_esente === true ? 'esente' : r.iva_inclusa === true ? 'inclusa' : 'esclusa'

export async function statoIvaListino(admin: any, listinoId: string): Promise<StatoIvaListino> {
  const stato: StatoIvaListino = { listino: null, corrieri: {} }
  const leggi = (campi: string) => admin.from('listini_iva')
    .select(campi).eq('listino_id', listinoId)
    .order('creato_il', { ascending: false }).order('id', { ascending: false }).limit(1000)
  let { data, error } = await leggi('corriere_id,iva_inclusa,iva_esente,creato_il,id')
  // Finche' scripts/iva-esente.sql non e' lanciato la colonna non c'e': nessuno ha scelto esente.
  if (error && String(error.code || '') === '42703') ({ data, error } = await leggi('corriere_id,iva_inclusa,creato_il,id'))
  if (error) {
    if (TABELLA_ASSENTE.has(String(error.code || ''))) return stato
    throw new Error('Impostazioni IVA del listino non leggibili: ' + error.message)
  }
  let listinoVisto = false
  for (const r of data || []) {
    if (!r.corriere_id) { if (!listinoVisto) { stato.listino = regimeRiga(r) ?? 'esclusa'; listinoVisto = true } continue }
    if (!(r.corriere_id in stato.corrieri)) stato.corrieri[r.corriere_id] = regimeRiga(r)
  }
  return stato
}

// PER L'ETICHETTA "IVA escl. / IVA incl. / Esente IVA" accanto ai prezzi: come e' venduto OGGI il listino di chi compra,
// con la sua aliquota. Se la lettura non riesce torna null e le pagine non mostrano l'etichetta: un
// prezzo senza etichetta e' meglio di un prezzo che non si carica.
//
// SOLO SE IL MASTER HA SCELTO. "IVA esclusa" e' il punto di partenza dei report, non una dichiarazione
// del master: Velox vende ai suoi clienti IVA inclusa senza averlo mai impostato, e il 20/11 i suoi clienti
// si sono trovati "+ IVA" accanto a prezzi che la contenevano gia' (telefonata a Lorenzo). Un listino su
// cui nessuno ha scelto niente non mostra nessuna etichetta, come prima.
export async function infoIvaPrezzi(admin: any, listinoId: string | null | undefined, aliquota: number): Promise<InfoIvaPrezzi | null> {
  try {
    if (!listinoId) return null
    const s = await statoIvaListino(admin, listinoId)
    if (s.listino === null && !Object.values(s.corrieri).some(v => v != null)) return null
    return { aliquota, listino: s.listino, corrieri: s.corrieri }
  } catch (e: any) {
    console.error('[LISTINI IVA] etichetta non calcolata', listinoId, e?.message || e)
    return null
  }
}

// L'aliquota del cliente come la usano i report: vuota = 22.
export function aliquotaCliente(v: any): number {
  if (v === null || v === undefined || String(v).trim() === '') return 22
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 22
}

// Una risposta per riga, nello stesso ordine: 'inclusa', 'esclusa' o 'esente'. null = riga senza
// compratore (spedizioni proprie): esclusa.
export async function ivaVendite(admin: any, venditore: string | null | undefined, righe: (ChiestaIva | null)[]): Promise<RegimeIva[]> {
  const out: RegimeIva[] = righe.map(() => 'esclusa')
  if (!venditore || !righe.some(Boolean)) return out
  // Chi non ha mai toccato la scelta non paga niente: nessuna chiamata in piu'.
  if (!(await venditoreUsaIva(admin, venditore))) return out
  const elenco = righe
    .map((r, i) => (r && r.s && r.p ? { i, t: r.t, s: r.s, p: r.p, m: r.m || 'spedizione' } : null))
    .filter(Boolean) as { i: number; t: string; s: string; p: string; m: string }[]
  const blocchi: typeof elenco[] = []
  for (let k = 0; k < elenco.length; k += BLOCCO) blocchi.push(elenco.slice(k, k + BLOCCO))
  // iva_vendite_regime nasce con scripts/iva-esente.sql. Finche' non c'e' nessuno ha scelto esente, e
  // quella di ieri (si'/no IVA inclusa) da' le stesse risposte.
  let nuova = true
  const chiedi = async (b: typeof elenco) => {
    if (nuova) {
      const { data, error } = await admin.rpc('iva_vendite_regime', { p_venditore: venditore, p_righe: b })
      if (!error) return (data || []).map((r: any) => ({ i: Number(r.i), v: regimeDaDb(r.regime) }))
      if (String(error.code || '') !== 'PGRST202') throw new Error('IVA delle vendite non leggibile: ' + error.message)
      nuova = false
    }
    const { data, error } = await admin.rpc('iva_vendite_spedizioni', { p_venditore: venditore, p_righe: b })
    if (error) throw new Error('IVA delle vendite non leggibile: ' + error.message)
    return (data || []).map((r: any) => ({ i: Number(r.i), v: (r.iva_inclusa === true ? 'inclusa' : 'esclusa') as RegimeIva }))
  }
  // Il primo blocco da solo: dice se la funzione nuova c'e'. Poi quattro alla volta, come le altre letture a blocchi.
  for (let k = 0; k < blocchi.length; k += k === 0 ? 1 : 4) {
    const gruppo = k === 0 ? [blocchi[0]] : blocchi.slice(k, k + 4)
    await Promise.all(gruppo.map(async (b) => {
      const risposte = await chiedi(b)
      if (risposte.length !== b.length) throw new Error(`IVA delle vendite incompleta: ${risposte.length} risposte su ${b.length}`)
      for (const r of risposte) out[r.i] = r.v
    }))
  }
  return out
}

// Il database risponde con una di tre parole; qualunque altra cosa ferma il report invece di diventare
// "IVA esclusa" in silenzio.
function regimeDaDb(v: any): RegimeIva {
  if (v === 'inclusa' || v === 'esclusa' || v === 'esente') return v
  throw new Error('IVA delle vendite: risposta non riconosciuta (' + String(v) + ')')
}
