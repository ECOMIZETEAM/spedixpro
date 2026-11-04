import { istanteDaOraRoma } from '@/lib/date-roma'

// QUANDO E' STATO FATTO L'ORDINE, letto dalla riga del file importato.
// Tutte le righe di un file entrano nello stesso istante (un insert solo): l'elenco ordinato per ora
// d'import lasciava al caso l'ordine dentro il file. 02/11/2026, file Amazon di SOLONATURA (37
// ordini): in cima un ordine del 31/10, secondo il piu' vecchio di tutti (30/10), sesto il piu'
// recente (02/11). La data vera e' scritta nel file: si legge da qui.
//
// Colonne gia' normalizzate da normHeader (app/api/ordini/importa), nei formati visti negli import veri:
//   purchasedate      Amazon "purchase-date"   2026-09-09T05:06:24+00:00
//   created_at        Shopify "Created at"     2024-08-01 14:24:51 +0200
//   data_di_acquisto  Temu                     28 ago 2026, 14:20 CEST(UTC+2) · Sep 10, 2026 10:53:36 AM
//   date_purchased                             2026-09-09 13:54:54 (senza fuso: ora di Roma)
// La prima colonna presente e leggibile vince. Una data che non si capisce resta NULL: l'ordine si
// mette allora all'ora d'import, come prima, invece di finire in un punto inventato.
const COLONNE = ['purchasedate', 'created_at', 'data_di_acquisto', 'date_purchased', 'order_date', 'data_ordine']

const MESI: Record<string, number> = {
  gen: 1, jan: 1, feb: 2, mar: 3, apr: 4, mag: 5, may: 5, giu: 6, jun: 6, lug: 7, jul: 7,
  ago: 8, aug: 8, set: 9, sep: 9, ott: 10, oct: 10, nov: 11, dic: 12, dec: 12,
}

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i
const RE_GIORNO_MESE = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*[a-z]{2,5})?\s*(?:\(\s*utc\s*([+-]\d{1,2})(?::?(\d{2}))?\s*\))?$/i
const RE_MESE_GIORNO = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i
const RE_ITALIANA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

function istante(a: number, me: number, g: number, h: number, mi: number, s: number, scartoMinuti: number | null): Date | null {
  if (me < 1 || me > 12 || g < 1 || g > 31 || h > 23 || mi > 59 || s > 59) return null
  // 31/02 per Date.UTC diventa il 3 marzo: una data che non esiste non e' una data.
  if (new Date(Date.UTC(a, me - 1, g)).getUTCDate() !== g) return null
  const d = scartoMinuti === null
    ? istanteDaOraRoma(a, me, g, h, mi, s)
    : new Date(Date.UTC(a, me - 1, g, h, mi, s) - scartoMinuti * 60000)
  // Fuori da ogni ordine possibile (anno sbagliato, una colonna che non era la data): non la si usa.
  const t = d.getTime()
  if (t < Date.UTC(2000, 0, 1) || t > Date.now() + 2 * 86400000) return null
  return d
}

function scartoDa(tz: string | undefined): number | null {
  if (!tz) return null
  if (tz.toUpperCase() === 'Z') return 0
  const m = tz.match(/^([+-])(\d{2}):?(\d{2})$/)
  if (!m) return null
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/** Una data come la scrivono i file d'ordini, o null se non si capisce. */
export function leggiDataOrdine(testo: string): Date | null {
  const v = String(testo ?? '').trim()
  if (!v) return null
  let m = v.match(RE_ISO)
  if (m) return istante(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), scartoDa(m[7]))
  m = v.match(RE_GIORNO_MESE)
  if (m) {
    const me = MESI[m[2].toLowerCase()]
    if (!me) return null
    const scarto = m[7] ? (m[7].startsWith('-') ? -1 : 1) * (Math.abs(Number(m[7])) * 60 + Number(m[8] || 0)) : null
    return istante(+m[3], me, +m[1], +m[4], +m[5], +(m[6] || 0), scarto)
  }
  m = v.match(RE_MESE_GIORNO)
  if (m) {
    const me = MESI[m[1].toLowerCase()]
    if (!me) return null
    let h = +m[4]
    const ap = (m[7] || '').toLowerCase()
    if (ap && (h < 1 || h > 12)) return null
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return istante(+m[3], me, +m[2], h, +m[5], +(m[6] || 0), null)
  }
  m = v.match(RE_ITALIANA)
  if (m) return istante(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), null)
  return null
}

/** Quando e' stato fatto l'ordine di questa riga del file (ISO UTC), o null se il file non lo dice. */
export function dataOrdineDaRiga(r: Record<string, unknown> | null | undefined): string | null {
  if (!r) return null
  for (const k of COLONNE) {
    const d = leggiDataOrdine(String(r[k] ?? ''))
    if (d) return d.toISOString()
  }
  return null
}

type OrdinePerData = { data_ordine?: string | null; created_at?: string | null; riga_file?: number | null }
const ms = (v: string | null | undefined) => { const t = v ? Date.parse(v) : NaN; return Number.isNaN(t) ? 0 : t }

/**
 * Elenco degli ordini importati "per data", dal piu' vecchio: quando e' stato fatto l'ordine (o l'ora
 * d'import, se il file non lo dice), poi l'ora d'import, poi la riga del file. Al contrario per
 * "piu' recenti": confrontaPerData(b, a).
 */
export function confrontaPerData(a: OrdinePerData, b: OrdinePerData): number {
  return ms(a.data_ordine || a.created_at) - ms(b.data_ordine || b.created_at)
    || ms(a.created_at) - ms(b.created_at)
    || (a.riga_file ?? 0) - (b.riga_file ?? 0)
}
