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

import type { InfoIvaPrezzi } from '@/lib/iva-calcolo'

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

// COME E' VENDUTO OGGI UN LISTINO, per l'editor: la scelta del listino e quella di ogni contratto
// impostato a parte (null = "come il listino"). Vale l'ultima scelta fatta, come in fn_iva_inclusa_al:
// le scelte partono sempre da oggi o da inizio mese, quindi l'ultima fatta e' quella in vigore adesso.
// `scelto`: il master ha fatto almeno una scelta su questo listino (altrimenti vale il punto di partenza).
export type StatoIvaListino = { listino: boolean; corrieri: Record<string, boolean | null>; scelto?: boolean }

export async function statoIvaListino(admin: any, listinoId: string): Promise<StatoIvaListino> {
  const stato: StatoIvaListino = { listino: false, corrieri: {}, scelto: false }
  const { data, error } = await admin.from('listini_iva')
    .select('corriere_id,iva_inclusa,creato_il,id').eq('listino_id', listinoId)
    .order('creato_il', { ascending: false }).order('id', { ascending: false }).limit(1000)
  if (error) {
    if (TABELLA_ASSENTE.has(String(error.code || ''))) return stato
    throw new Error('Impostazioni IVA del listino non leggibili: ' + error.message)
  }
  let listinoVisto = false
  stato.scelto = (data || []).length > 0
  for (const r of data || []) {
    if (!r.corriere_id) { if (!listinoVisto) { stato.listino = r.iva_inclusa === true; listinoVisto = true } continue }
    if (!(r.corriere_id in stato.corrieri)) stato.corrieri[r.corriere_id] = r.iva_inclusa == null ? null : r.iva_inclusa === true
  }
  return stato
}

// PER L'ETICHETTA "+ IVA / IVA incl." accanto ai prezzi: come e' venduto OGGI il listino di chi compra,
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
    if (!s.scelto) return null
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

// Una risposta per riga, nello stesso ordine. null = riga senza compratore (spedizioni proprie): esclusa.
export async function ivaVendite(admin: any, venditore: string | null | undefined, righe: (ChiestaIva | null)[]): Promise<boolean[]> {
  const out = righe.map(() => false)
  if (!venditore || !righe.some(Boolean)) return out
  // Chi non ha mai toccato l'interruttore non paga niente: nessuna chiamata in piu'.
  if (!(await venditoreUsaIva(admin, venditore))) return out
  const elenco = righe
    .map((r, i) => (r && r.s && r.p ? { i, t: r.t, s: r.s, p: r.p, m: r.m || 'spedizione' } : null))
    .filter(Boolean) as { i: number; t: string; s: string; p: string; m: string }[]
  const blocchi: typeof elenco[] = []
  for (let k = 0; k < elenco.length; k += BLOCCO) blocchi.push(elenco.slice(k, k + BLOCCO))
  // Quattro blocchi alla volta, come le altre letture a blocchi dei report.
  for (let k = 0; k < blocchi.length; k += 4) {
    await Promise.all(blocchi.slice(k, k + 4).map(async (b) => {
      const { data, error } = await admin.rpc('iva_vendite_spedizioni', { p_venditore: venditore, p_righe: b })
      if (error) throw new Error('IVA delle vendite non leggibile: ' + error.message)
      if (!Array.isArray(data) || data.length !== b.length) throw new Error(`IVA delle vendite incompleta: ${data?.length ?? 0} risposte su ${b.length}`)
      for (const r of data) out[Number(r.i)] = r.iva_inclusa === true
    }))
  }
  return out
}
