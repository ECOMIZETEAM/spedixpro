// IL CALENDARIO IN FORMATO .ics (RFC 5545), per Google Calendar e l'iPhone (fase 2, 25/11/2026).
//
// COSA ESCE (scelta di Lorenzo, 25/11: «solo le tue voci»): le voci proprie e quelle a cui si è invitati e non si è
// detto di no, con titolo, orario e luogo. NON escono: note, ritiri, giacenze, invitati, e il nome del destinatario
// della spedizione collegata — il link si legge senza la verifica in due passaggi, quindi porta fuori solo il minimo.
// Il titolo scritto da «Ricordamelo» contiene il destinatario («Ricontrolla 123 · Mario Rossi»): qui resta il numero.
//
// Le voci che si ripetono escono come serie (RRULE), con l'ora di Roma (TZID=Europe/Rome): Google e l'iPhone le
// srotolano da soli e restano alle 9 anche dopo il cambio dell'ora.
import { partiRoma, type Ricorrenza } from '@/lib/calendario-ricorrenza'
import { istanteDaOraRoma } from '@/lib/date-roma'

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
]
const due = (n: number) => String(n).padStart(2, '0')
const testo = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const dataLocale = (d: Date) => { const p = partiRoma(d); return `${p.a}${due(p.m)}${due(p.g)}T${due(p.h)}${due(p.mi)}00` }
const soloData = (d: Date) => { const p = partiRoma(d); return `${p.a}${due(p.m)}${due(p.g)}` }
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const giornoDopo = (d: Date) => { const p = partiRoma(d); return istanteDaOraRoma(p.a, p.m, p.g + 1) }
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

// righe lunghe spezzate a 75 byte, come vuole la norma (Google le accetta anche lunghe, l'iPhone no)
function piega(riga: string): string {
  const b = Buffer.from(riga, 'utf8')
  if (b.length <= 75) return riga
  const pezzi: string[] = []
  let i = 0, primo = true
  while (i < b.length) {
    let fine = Math.min(b.length, i + (primo ? 75 : 74))
    while (fine < b.length && (b[fine] & 0xc0) === 0x80) fine--   // non si spezza un carattere a metà
    pezzi.push((primo ? '' : ' ') + b.subarray(i, fine).toString('utf8'))
    i = fine; primo = false
  }
  return pezzi.join('\r\n')
}

export type VoceIcs = {
  id: string; titolo: string; inizio: string; fine: string | null; tutto_il_giorno: boolean; luogo: string | null
  ricorrenza: Ricorrenza | null; eccezioni: string[] | null; collegamento: any; aggiornato: string | null
}

export function titoloSenzaNomi(v: { titolo: string; collegamento?: any }): string {
  const et = String(v.collegamento?.etichetta || '')
  if (!et) return v.titolo
  const numero = et.split(' · ')[0] || 'spedizione'
  return v.titolo.includes(et) ? v.titolo.replace(et, numero) : v.titolo
}

export function calendarioIcs(nome: string, voci: VoceIcs[], linkPortale: string): string {
  const righe: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MoovExpress//Calendario//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${testo(nome)}`, 'X-WR-TIMEZONE:Europe/Rome', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...VTIMEZONE]
  const ora = utc(new Date())
  for (const v of voci) {
    const ini = new Date(v.inizio)
    const fin = v.fine ? new Date(v.fine) : null
    righe.push('BEGIN:VEVENT', `UID:${v.id}@moovexpress.com`, `DTSTAMP:${ora}`)
    if (v.aggiornato) righe.push(`LAST-MODIFIED:${utc(new Date(v.aggiornato))}`)
    if (v.tutto_il_giorno) {
      righe.push(`DTSTART;VALUE=DATE:${soloData(ini)}`)
      // la fine delle .ics è esclusa: l'ultimo giorno + 1
      righe.push(`DTEND;VALUE=DATE:${soloData(giornoDopo(fin || ini))}`)
    } else {
      righe.push(`DTSTART;TZID=Europe/Rome:${dataLocale(ini)}`)
      // un promemoria è un momento: mezz'ora, come lo disegna il calendario
      righe.push(`DTEND;TZID=Europe/Rome:${dataLocale(fin || new Date(ini.getTime() + 30 * 60000))}`)
    }
    const r = v.ricorrenza
    if (r) {
      const parti = [`FREQ=${{ giorno: 'DAILY', settimana: 'WEEKLY', mese: 'MONTHLY', anno: 'YEARLY' }[r.freq]}`, `INTERVAL=${r.ogni || 1}`]
      if (r.freq === 'settimana' && r.giorni?.length) parti.push(`BYDAY=${r.giorni.map((g) => BYDAY[g]).join(',')}`)
      if (r.fino) {
        const [a, m, g] = r.fino.split('-').map(Number)
        // con DTSTART all'ora di Roma, UNTIL va in UTC; con le date pure, data pura
        parti.push(v.tutto_il_giorno ? `UNTIL=${r.fino.replace(/-/g, '')}` : `UNTIL=${utc(istanteDaOraRoma(a, m, g, 23, 59, 59))}`)
      } else if (r.volte) parti.push(`COUNT=${r.volte}`)
      righe.push(`RRULE:${parti.join(';')}`)
      const p = partiRoma(ini)
      for (const k of v.eccezioni || []) {
        const [a, m, g] = k.split('-').map(Number)
        righe.push(v.tutto_il_giorno ? `EXDATE;VALUE=DATE:${k.replace(/-/g, '')}` : `EXDATE;TZID=Europe/Rome:${a}${due(m)}${due(g)}T${due(p.h)}${due(p.mi)}00`)
      }
    }
    righe.push(`SUMMARY:${testo(titoloSenzaNomi(v))}`)
    if (v.luogo) righe.push(`LOCATION:${testo(v.luogo)}`)
    righe.push(`URL:${linkPortale}`, 'END:VEVENT')
  }
  righe.push('END:VCALENDAR')
  return righe.map(piega).join('\r\n') + '\r\n'
}
