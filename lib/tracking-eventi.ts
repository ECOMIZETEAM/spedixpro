// ═══════════════════════════════════════════════════════════════════════════
// CRONOLOGIA DI TRACCIAMENTO — un posto solo per la data e per la scrittura.
//
// Gli eventi (`tracking_events`) sono quelli che il destinatario vede aprendo il link del tracking.
// Fino al 8/09/2026 li scrivevano SOLO il webhook Spedisci, il poller Poste e il poller GLS-via-
// Spedisci: per SpediamoPro, DVA, GLS diretto e BRT diretto lo stato avanzava e la cronologia
// restava vuota. Non era un guasto, non era mai stato fatto — e ogni provider che si aggiunge
// rischia di ripetere la dimenticanza. Per questo la regola sta qui, non in ogni ramo del cron.
// ═══════════════════════════════════════════════════════════════════════════

// DATA/ORA DEL CORRIERE → ISTANTE VERO.
//
// I provider mandano le date in due forme: con il fuso ("2026-01-03T10:41:08Z", "…+02:00") oppure
// SENZA ("2026-01-03 10:41:08"). La seconda e' ora ITALIANA: leggerla com'e' su un server che gira
// a UTC — il nostro — sposterebbe ogni evento di una o due ore, e una cronologia sfasata e' peggio
// di nessuna cronologia. Lo scarto Roma/UTC si misura NELL'ISTANTE dell'evento, cosi' vale sia in
// ora legale che solare.
export function istanteDaTesto(v: any): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  // Con fuso esplicito (Z oppure ±hh:mm): non c'e' niente da interpretare.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (!m) return null
  const comeUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  if (!Number.isFinite(comeUtc)) return null
  const parti = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(comeUtc))
  const g = (t: string) => Number(parti.find(x => x.type === t)?.value)
  const romaComeUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  if (!Number.isFinite(romaComeUtc)) return null
  return new Date(comeUtc - (romaComeUtc - comeUtc)).toISOString()
}

export type EventoTracking = { descrizione: string; luogo: string | null; data_evento: string }

// Normalizza gli eventi di QUALSIASI provider: si passano i nomi dei campi, non la loro forma.
// Un evento SENZA data riconoscibile viene SCARTATO: mai inventarne una: una cronologia falsa e'
// peggio del buco. Le chiavi degli scartati tornano al chiamante, che le puo' loggare e chiudere
// la cosa al primo giro invece di lasciarla un mistero.
export function normalizzaEventi(
  righe: any[],
  campi: { data: string[]; descrizione: string[]; luogo?: string[] },
): { eventi: EventoTracking[]; chiaviIgnote: string[] } {
  const eventi: EventoTracking[] = []
  const chiaviIgnote = new Set<string>()
  for (const ev of (Array.isArray(righe) ? righe : [])) {
    if (!ev || typeof ev !== 'object') continue
    let descrizione = ''
    for (const k of campi.descrizione) { const v = String(ev[k] ?? '').trim(); if (v) { descrizione = v; break } }
    if (!descrizione) continue
    let quando: string | null = null
    for (const k of campi.data) { quando = istanteDaTesto(ev[k]); if (quando) break }
    if (!quando) { for (const k of Object.keys(ev)) chiaviIgnote.add(k); continue }
    let luogo: string | null = null
    for (const k of (campi.luogo || [])) { const v = String(ev[k] ?? '').trim(); if (v) { luogo = v.slice(0, 200); break } }
    eventi.push({ descrizione: descrizione.slice(0, 300), luogo, data_evento: quando })
  }
  return { eventi, chiaviIgnote: Array.from(chiaviIgnote) }
}

// CANCELLA E RISCRIVI, come fa il poller Poste. Le risposte dei corrieri arrivano COMPLETE a ogni
// giro: aggiungere in coda riempirebbe di doppioni il popup del cliente. Torna quanti eventi ha
// scritto (0 = niente da scrivere, e in quel caso non cancella nulla: meglio la cronologia vecchia
// che nessuna cronologia, se per un giro il corriere risponde vuoto).
export async function scriviCronologia(admin: any, spedizioneId: string, eventi: EventoTracking[]): Promise<number> {
  if (!spedizioneId || !eventi.length) return 0
  await admin.from('tracking_events').delete().eq('spedizione_id', spedizioneId)
  await admin.from('tracking_events').insert(eventi.map(e => ({ spedizione_id: spedizioneId, ...e })))
  return eventi.length
}
