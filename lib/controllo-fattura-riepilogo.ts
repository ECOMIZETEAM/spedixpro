/* I TOTALI DI UNA FATTURA CONTROLLATA. Li usano la pagina (per i numeri a schermo) e la rotta (per lo
 * storico): stessa funzione, così il totale salvato nello storico è quello che il detentore ha visto.
 * Niente database qui: gira nel browser e sul server. */
import type { RigaFatturaBrt } from '@/lib/fattura-brt'

export type MotivoPagina = { tipo: 'peso' | 'supplemento' | 'voce' | 'tariffa' | 'annullata' | 'non_calcolabile'; importo: number; testo: string }
export type EsitoPagina = {
  riga: RigaFatturaBrt
  spedizione: { id: string; numero: string; stato: string; data: string; colli: number; peso: number; contrassegno: number; citta: string; chi: string } | null
  abbinataPer: 'riferimento' | 'segnacollo' | null
  brt: number; moove: number | null; listino: number | null; zona: string | null; differenza: number | null
  motivi: MotivoPagina[]; voci: Record<string, number>
}

const r2 = (n: number) => Math.round(n * 100) / 100

// Le spedizioni da girare ai clienti: andata, trovata, non annullata, e il peso del corriere fa salire il
// costo col listino. Sono le sole che "Manda alla Rettifica" spedisce.
export const daGirare = (e: EsitoPagina) => !!e.spedizione && e.riga.andata && e.spedizione.stato !== 'annullata'
  && e.motivi.some(m => m.tipo === 'peso' && m.importo > 0.005)

export function riepilogaFattura(esiti: EsitoPagina[]) {
  const t = { righe: esiti.length, andate: 0, rientri: 0, totaleCorriere: 0, totaleRientri: 0, totaleTrovate: 0, costoMoove: 0, trovate: 0,
    nonTrovate: 0, totaleNonTrovate: 0, daGirare: 0, euroDaGirare: 0 }
  const perMotivo: Record<string, { n: number; euro: number }> = {}
  const perVoce: Record<string, { n: number; euro: number }> = {}
  for (const e of esiti) {
    t.totaleCorriere += e.brt
    if (e.riga.andata) t.andate++; else { t.rientri++; t.totaleRientri += e.brt }
    if (!e.spedizione) { t.nonTrovate++; t.totaleNonTrovate += e.brt; continue }
    t.trovate++; t.totaleTrovate += e.brt; t.costoMoove += e.moove || 0
    if (daGirare(e)) { t.daGirare++; t.euroDaGirare += e.motivi.find(m => m.tipo === 'peso')?.importo || 0 }
    for (const m of e.motivi) {
      const v = perMotivo[m.tipo] || { n: 0, euro: 0 }; v.n++; v.euro = r2(v.euro + m.importo); perMotivo[m.tipo] = v
      if (m.tipo === 'voce') {
        const s = m.testo.match(/sigla BRT "([^"]+)"/)?.[1] || '?'
        const w = perVoce[s] || { n: 0, euro: 0 }; w.n++; w.euro = r2(w.euro + m.importo); perVoce[s] = w
      }
    }
  }
  return {
    ...t,
    totaleCorriere: r2(t.totaleCorriere), totaleRientri: r2(t.totaleRientri), totaleTrovate: r2(t.totaleTrovate),
    costoMoove: r2(t.costoMoove), totaleNonTrovate: r2(t.totaleNonTrovate), euroDaGirare: r2(t.euroDaGirare),
    differenza: r2(t.totaleTrovate - t.costoMoove),
    perMotivo, perVoce,
  }
}
