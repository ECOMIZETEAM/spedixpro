// Le date del calendario. Si ragiona nell'ora del dispositivo, che per chi usa il portale è l'ora di Roma: la
// settimana parte dal lunedì, i nomi sono in italiano. I giorni «senza ora» (data del ritiro, entrata in giacenza)
// viaggiano come 'YYYY-MM-DD' e si leggono come mezzanotte locale: con new Date('2026-11-27') sarebbero la
// mezzanotte di Greenwich, cioè l'una di notte da noi (e le 23 del giorno prima d'inverno a ovest).

export const GIORNI_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
export const GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
export const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

const due = (n: number) => String(n).padStart(2, '0')

export function inizioGiorno(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
export function piuGiorni(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()) }
export function piuMesi(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
export function stessoGiorno(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
// lunedì = 0 … domenica = 6
export function giornoSettimana(d: Date): number { return (d.getDay() + 6) % 7 }
export function inizioSettimana(d: Date): Date { return piuGiorni(inizioGiorno(d), -giornoSettimana(d)) }

export function chiaveGiorno(d: Date): string { return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}` }
export function daChiave(k: string): Date { const [a, m, g] = k.slice(0, 10).split('-').map(Number); return new Date(a, m - 1, g) }

// la griglia del mese: dal lunedì della prima settimana alla domenica dell'ultima (5 o 6 righe)
export function giorniMese(ancora: Date): Date[] {
  const primo = new Date(ancora.getFullYear(), ancora.getMonth(), 1)
  const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0)
  const da = inizioSettimana(primo)
  const a = piuGiorni(inizioSettimana(ultimo), 6)
  const out: Date[] = []
  for (let d = da; d <= a; d = piuGiorni(d, 1)) out.push(d)
  return out
}
export function giorniSettimana(ancora: Date): Date[] {
  const da = inizioSettimana(ancora)
  return Array.from({ length: 7 }, (_, i) => piuGiorni(da, i))
}

export function ora(d: Date): string { return `${due(d.getHours())}:${due(d.getMinutes())}` }
export function oraBreve(d: Date): string { return d.getMinutes() ? ora(d) : String(d.getHours()) }
export function dataLunga(d: Date): string { return `${GIORNI[giornoSettimana(d)]} ${d.getDate()} ${MESI[d.getMonth()]}` }
export function dataMedia(d: Date): string { return `${GIORNI_BREVI[giornoSettimana(d)]} ${d.getDate()} ${MESI_BREVI[d.getMonth()]}` }

// «oggi», «domani», «ieri» o la data: per i promemoria e la lista «Da fare»
export function quandoRelativo(d: Date, adesso = new Date()): string {
  const diff = Math.round((inizioGiorno(d).getTime() - inizioGiorno(adesso).getTime()) / 86400000)
  if (diff === 0) return 'oggi'
  if (diff === 1) return 'domani'
  if (diff === -1) return 'ieri'
  return dataMedia(d)
}

// il valore per <input type="date"> e <input type="time">
export function valoreData(d: Date): string { return chiaveGiorno(d) }
export function valoreOra(d: Date): string { return ora(d) }
export function componi(data: string, oraTesto: string): Date {
  const [a, m, g] = data.split('-').map(Number)
  const [h, mi] = (oraTesto || '00:00').split(':').map(Number)
  return new Date(a, m - 1, g, h || 0, mi || 0)
}

// il titolo del periodo mostrato
export function titoloPeriodo(vista: string, ancora: Date): string {
  if (vista === 'mese') return `${MESI[ancora.getMonth()]} ${ancora.getFullYear()}`
  if (vista === 'giorno') return `${dataLunga(ancora)} ${ancora.getFullYear()}`
  if (vista === 'settimana') {
    const g = giorniSettimana(ancora), a = g[0], b = g[6]
    if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${MESI[b.getMonth()]} ${b.getFullYear()}`
    if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${MESI_BREVI[a.getMonth()]} – ${b.getDate()} ${MESI_BREVI[b.getMonth()]} ${b.getFullYear()}`
    return `${a.getDate()} ${MESI_BREVI[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MESI_BREVI[b.getMonth()]} ${b.getFullYear()}`
  }
  return 'Prossimi 30 giorni'
}
