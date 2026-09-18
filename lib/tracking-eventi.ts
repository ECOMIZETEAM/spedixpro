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
  // Con fuso esplicito (Z oppure ±hh:mm) DOPO UN ORARIO: non c'e' niente da interpretare.
  // L'orario prima del fuso e' obbligatorio. Senza, "10-09-2026" (la data italiana di DVA, col
  // trattino) veniva presa per una data col fuso "-20:26" e passata a new Date(), che la legge
  // ALL'AMERICANA: 9 ottobre invece del 10 settembre, a mezzanotte. E "15-09-2026" (mese 15) non
  // si leggeva affatto: l'evento spariva. Misurato il 18/09: 13.767 eventi DVA con la data
  // sbagliata (10.606 nel futuro, 3.161 prima della nascita della spedizione) e tutti quelli dal
  // 13 al 31 del mese mai salvati.
  if (/\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  // Data ITALIANA (giorno-mese-anno, col trattino, la barra o il punto), con o senza orario: e' ora
  // di Roma. Non passa MAI da new Date(), che la leggerebbe mese-giorno.
  const it = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  const m: any = it
    ? [s, it[3], it[2].padStart(2, '0'), it[1].padStart(2, '0'), (it[4] || '00').padStart(2, '0'), it[5] || '00', it[6]]
    : /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (!m) return null
  if (+m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null
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

// L'ISTANTE → COME LO LEGGE CHI GUARDA IL POPUP.
// In `tracking_events` la data è ISO in UTC: stampata com'è, il popup mostrava
// "2026-09-10T09:39:00+00:00" per un evento delle 11:39 — due ore indietro e in un formato che
// nessuno legge. Gli altri corrieri mandano al popup date già scritte ("10/09/2026 11:39"): quelle
// NON vanno passate a new Date(), che le leggerebbe all'americana (9 ottobre) — si riconoscono
// dal formato e si lasciano stare.
export function dataEventoIt(v: any): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export type EventoTracking = { descrizione: string; luogo: string | null; data_evento: string }

// IL RESO VINCE SULLA CONSEGNA — per TUTTI i corrieri, non solo per Poste.
// Il pacco rifiutato torna al mittente e il ritorno si chiude con una "consegnata": chi sceglie lo
// stato piu' avanzato la prende per buona (consegnata 7 batte reso 6) e il pacco risulta arrivato a
// destinazione. Al 17/09/2026 erano 231 spedizioni, con il costo del reso mai addebitato alla rete.
// Si passa qui l'elenco degli stati gia' mappati dal ramo del corriere: se uno e' un reso, e' reso.
export function resoTraGliStati(stati: (string | null | undefined)[]): boolean {
  return (stati || []).some((s) => s === 'reso_mittente')
}

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

// SI AGGIUNGE, NON SI RISCRIVE.
// Prima qui c'era "cancella tutto e reinserisci", perche' i corrieri rimandano la cronologia
// completa a ogni giro e aggiungere in coda faceva doppioni. Ma una risposta piu' povera della
// precedente — il corriere che per un giro manda meno righe, o una lettura andata male a meta' —
// portava via eventi buoni: il cliente riapriva il tracking e non trovava piu' le descrizioni
// (Lorenzo, 17/09/2026: "una volta che scrivi non dovresti cancellarle al giro dopo").
// Adesso si scrive solo quello che manca: i doppioni li ferma la chiave unica del database
// (spedizione + istante + frase + luogo), non la cancellazione.
// `luogo` va a stringa vuota e mai a NULL: in un indice unico due NULL non sono uguali fra loro,
// e lo stesso evento senza luogo rientrerebbe a ogni giro.
export async function scriviCronologia(admin: any, spedizioneId: string, eventi: EventoTracking[]): Promise<number> {
  if (!spedizioneId || !eventi.length) return 0
  await admin.from('tracking_events').upsert(
    eventi.map(e => ({ spedizione_id: spedizioneId, ...e, luogo: e.luogo ?? '' })),
    { onConflict: 'spedizione_id,data_evento,descrizione,luogo', ignoreDuplicates: true },
  )
  return eventi.length
}
