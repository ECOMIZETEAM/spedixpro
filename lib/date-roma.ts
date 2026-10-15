// GIORNI DEL CALENDARIO ITALIANO. I filtri per data si ragionano a Roma, non a Greenwich.
// `toISOString().slice(0, 10)` da' il giorno UTC: fra mezzanotte e le 2 (le 1 d'inverno) per Greenwich e'
// ancora ieri, quindi "oggi" valeva ieri e le spedizioni fatte in quelle ore finivano nel giorno prima
// (~780 su ~180.000 misurate il 13/10/2026). Stesse funzioni nel browser e sul server: Intl con il fuso
// esplicito non dipende dal fuso della macchina (Vercel gira in UTC, i PC degli utenti in Italia).

const FMT_GIORNO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const FMT_ORA = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function parti(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const p: Record<string, string> = {}
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value
  return p
}

const RE_GIORNO = /^\d{4}-\d{2}-\d{2}$/

/** Il giorno di Roma ('YYYY-MM-DD') dell'istante dato (default: adesso). */
export function giornoRoma(d: Date = new Date()): string {
  const p = parti(FMT_GIORNO, d)
  return `${p.year}-${p.month}-${p.day}`
}

/** Il giorno di Roma di `n` giorni di CALENDARIO fa (non n×24 ore: a fine marzo un giorno ne dura 23). */
export function giorniFaRoma(n: number, d: Date = new Date()): string {
  const [y, m, g] = giornoRoma(d).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, g - n)).toISOString().slice(0, 10)
}

// Scarto di Roma da UTC (ms) nell'istante dato: +1h d'inverno, +2h d'estate.
function scartoRomaMs(d: Date): number {
  const p = parti(FMT_ORA, d)
  const comeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return comeUtc - Math.floor(d.getTime() / 1000) * 1000
}

/** Mezzanotte di Roma del giorno 'YYYY-MM-DD', come istante UTC ISO. */
export function inizioGiornoRomaISO(giorno: string): string {
  const [y, m, g] = giorno.split('-').map(Number)
  const mezzanotteUtc = Date.UTC(y, m - 1, g)
  // Lo scarto letto a mezzanotte UTC e' lo stesso della mezzanotte di Roma (22:00/23:00 UTC del giorno
  // prima): l'ora legale cambia alle 01:00 UTC, mai in quella finestra.
  return new Date(mezzanotteUtc - scartoRomaMs(new Date(mezzanotteUtc))).toISOString()
}

/**
 * Ultimo istante del giorno di Roma 'YYYY-MM-DD', al microsecondo: `<=` su questo valore equivale a
 * `<` sulla mezzanotte dopo (il database tiene i microsecondi, JavaScript solo i millisecondi).
 */
export function fineGiornoRomaISO(giorno: string): string {
  const [y, m, g] = giorno.split('-').map(Number)
  const dopo = inizioGiornoRomaISO(new Date(Date.UTC(y, m - 1, g + 1)).toISOString().slice(0, 10))
  return new Date(new Date(dopo).getTime() - 1).toISOString().replace(/\.(\d{3})Z$/, '.$1999Z')
}

/**
 * Normalizza i parametri `dal`/`al` di una lista: un giorno puro ('2026-10-13') o la vecchia fine giornata
 * ('2026-10-13T23:59:59', mandata dalle pagine) diventano i confini del giorno DI ROMA; un istante gia'
 * completo (con fuso o 'Z') resta com'e'. `null` resta `null`.
 */
export function confineGiornoRoma(v: string | null, lato: 'dal' | 'al'): string | null {
  if (!v) return v
  const s = v.trim()
  const giorno = s.slice(0, 10)
  if (!RE_GIORNO.test(giorno)) return s
  const resto = s.slice(10)
  if (lato === 'dal' && (resto === '' || /^T00:00(:00(\.0+)?)?$/.test(resto))) return inizioGiornoRomaISO(giorno)
  if (lato === 'al' && (resto === '' || /^T23:59:59(\.\d+)?$/.test(resto))) return fineGiornoRomaISO(giorno)
  return s
}
