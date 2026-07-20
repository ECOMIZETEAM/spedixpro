// Pulisce l'errore tecnico del corriere/provider in un messaggio mostrabile all'utente, SENZA mai
// esporre il nome del provider tecnico (SpediamoPro / Spedisci.online): l'utente vede solo i brand
// dei corrieri, mai il provider a valle. Estrae il messaggio utile dal JSON di errore quando c'è.
export function erroreRitiroPulito(raw: any): string {
  const s = String(raw?.message ?? raw ?? '')
  let msg = ''
  const j = s.match(/\{[\s\S]*\}/)          // c'è un JSON del corriere?
  if (j) { try { const o = JSON.parse(j[0]); msg = o?.error?.message || o?.message || (typeof o?.error === 'string' ? o.error : '') || '' } catch {} }
  if (!msg) msg = s.replace(/^.*?failed[^:]*:\s*/i, '').replace(/\{[\s\S]*\}/, '').trim()
  msg = msg.replace(/spediamo\s*pro/ig, '').replace(/spedisci(\.online)?/ig, '').replace(/pickup failed[^:]*:?/ig, '').replace(/\s{2,}/g, ' ').trim()
  if (!msg || msg.startsWith('{') || /^\(?\d{3}\)?$/.test(msg) || /validation failed/i.test(msg)) msg = 'Ritiro non disponibile per questa spedizione.'
  return msg
}
