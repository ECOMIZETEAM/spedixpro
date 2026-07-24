// Pulisce l'errore tecnico del corriere/provider in un messaggio mostrabile all'utente, SENZA mai
// esporre il nome del provider tecnico (SpediamoPro / Spedisci.online): l'utente vede solo i brand
// dei corrieri, mai il provider a valle. Estrae il messaggio utile dal JSON di errore quando c'è.
export function erroreRitiroPulito(raw: any): string {
  const s0 = String(typeof raw === 'string' ? raw : JSON.stringify(raw || ''))
  if (/PICKUP_DATE\s*=\s*today/i.test(s0)) {
    return 'Il corriere non accetta più il ritiro in giornata: scegli una data da domani in poi.'
  }
  const s = String(raw?.message ?? raw ?? '')
  let msg = ''
  let dettagli: Array<{ source?: string; message?: string }> = []
  const j = s.match(/\{[\s\S]*\}/)          // c'è un JSON del corriere?
  if (j) {
    try {
      const o = JSON.parse(j[0])
      msg = o?.error?.message || o?.message || (typeof o?.error === 'string' ? o.error : '') || ''
      if (Array.isArray(o?.error?.details)) dettagli = o.error.details
    } catch {}
  }
  // Errori di validazione con DETTAGLIO campo: traduco i campi tipici in indicazioni concrete
  // (il generico "Validation failed" faceva credere che il corriere fosse rotto).
  const campi = dettagli.map(d => String(d?.source || '')).join(' ')
  if (/contactinfo\.phone|shipfrom\.phone|\bphone\b/i.test(campi)) {
    return 'Telefono del mittente mancante o non valido: inserisci un numero di telefono (solo cifre) e riprova.'
  }
  if (/contactinfo\.email|\bemail\b/i.test(campi)) {
    return 'Email del mittente non valida: correggila e riprova.'
  }
  if (/province|state/i.test(campi)) {
    return 'Provincia del mittente mancante o non valida: usa la sigla a 2 lettere (es. RM) e riprova.'
  }
  if (/postalcode|\bcap\b|zip/i.test(campi)) {
    return 'CAP del mittente mancante o non valido: correggilo e riprova.'
  }
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
  if (!msg || msg.startsWith('{') || /^\(?\d{3}\)?$/.test(msg) || /validation failed/i.test(msg)) {
    // Se il corriere ha indicato i campi problematici, meglio mostrarli che un generico "non
    // disponibile" — ma SEMPRE ripuliti: i details[] arrivano grezzi dal provider e possono
    // contenere nomi/URL tecnici che l'utente non deve mai vedere.
    const scrub = (t: string) => t
      .replace(/spediamo\s*pro/ig, 'il corriere').replace(/spedisci(\.online)?/ig, 'il corriere')
      .replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()
    const spiegazioni = dettagli.map(d => scrub([d?.source, d?.message].filter(Boolean).join(': '))).filter(Boolean).join('; ')
    msg = spiegazioni
      ? `Dati non accettati dal corriere — ${spiegazioni}. Correggi e riprova.`
      : 'Ritiro non disponibile per questa spedizione.'
  }
  return msg
}
