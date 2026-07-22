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
  // Messaggi tipici del corriere → testo chiaro in italiano per l'utente.
  if (/pickup_date\s*=\s*today.*no longer possible/i.test(msg) || /today.*no longer possible/i.test(msg)) {
    return 'Il ritiro in giornata non è più disponibile per questo corriere: scegli una data futura (di norma il giorno lavorativo successivo).'
  }
  if (/nessun prezzo impostato nel listino/i.test(msg)) {
    return 'Il corriere non ha una tariffa di ritiro per questo contratto/peso: programma il ritiro dal portale del corriere.'
  }
  if (/non idonea al ritiro/i.test(msg)) {
    return 'Il corriere non ha ancora finalizzato questa spedizione (etichetta in generazione): riprova il ritiro tra qualche minuto.'
  }
  if (/generic error/i.test(msg)) {
    return 'Il corriere ha rifiutato il ritiro per questa spedizione (spesso Poste in giornata o area non coperta): riprova con una data futura o programma dal portale del corriere.'
  }
  if (!msg || msg.startsWith('{') || /^\(?\d{3}\)?$/.test(msg) || /validation failed/i.test(msg)) msg = 'Ritiro non disponibile per questa spedizione.'
  return msg
}
