// Forma STANDARD che ogni controllo della Centrale di Controllo restituisce. La pagina la rende in
// automatico (KPI + tabella + filtri + CSV): aggiungere un controllo = una lib che ritorna questo + un
// endpoint + una card nel registro. Niente UI su misura per controllo.
export type Colonna = { key: string; label: string; align?: 'right'; tipo?: 'eur' | 'peso' | 'mono' | 'badge' }
export type ControlloRisultato = {
  kpi: { label: string; valore: string; colore?: string }[]
  colonne: Colonna[]
  righe: Record<string, any>[]
  categoriaKey?: string   // campo su cui offrire i chip-filtro (es. 'causa')
  cercaKeys?: string[]    // campi su cui cerca la casella di ricerca
  nota?: string
  csvNome: string
  finestra?: boolean      // true = il controllo usa il periodo in giorni
}
export const r2 = (n: number) => Math.round(n * 100) / 100
export const eur = (n: number) => (n < 0 ? '−' : '') + '€ ' + Math.abs(n).toFixed(2)
