// I formati e i nomi che la Dashboard nuova usa in tutte le sue parti (DashboardFinexy, SezioniFinexy).

// Intl it-IT non mette il punto sotto 10.000 («4203»): sui numeri si legge male, quindi sempre.
export const intero = (n: number) => Number(n || 0).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)
export const euro = (n: number) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)}`
export const percento = (n: number) => `${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

// Gli stati delle spedizioni: nome e colore, gli stessi della dashboard di oggi.
export const STATI: Record<string, [string, string]> = {
  in_lavorazione: ['In lavorazione', '#E0A100'], spedita: ['Spedita', '#0284C7'], in_transito: ['In transito', '#2563EB'],
  in_consegna: ['In consegna', '#EA580C'], consegnata: ['Consegnata', '#2E9B55'], in_giacenza: ['In giacenza', '#D9474E'],
  reso_mittente: ['Reso al mittente', '#374151'], non_consegnato: ['Non consegnato', '#6B7280'], annullata: ['Annullata', '#B8B8BD'],
  in_attesa_istruzioni: ['In attesa di istruzioni', '#4B5563'], annullamento_manuale: ['Annullo in corso', '#A3A3A8'],
  annullamento_pending: ['Annullo in corso', '#A3A3A8'], storno_richiesto: ['Annullo richiesto', '#A3A3A8'],
}
export const statoDi = (s: string): [string, string] => STATI[s] || [s.replace(/_/g, ' '), '#9CA3AF']

// Le statistiche mensili arrivano col mese in inglese («Nov 26»): in pagina si scrive in italiano.
const MESI: Record<string, string> = { jan: 'gen', feb: 'feb', mar: 'mar', apr: 'apr', may: 'mag', jun: 'giu', jul: 'lug', aug: 'ago', sep: 'set', oct: 'ott', nov: 'nov', dec: 'dic' }
export const meseItaliano = (m: string) => {
  const [a, b] = String(m || '').split(' ')
  const it = MESI[(a || '').toLowerCase()]
  return it ? `${it} ${b || ''}`.trim() : m
}
