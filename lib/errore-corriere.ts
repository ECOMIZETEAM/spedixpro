// NOMI DEI SISTEMI TECNICI A VALLE. Non devono mai comparire in un messaggio mostrato all'utente:
// gli errori dei corrieri arrivano grezzi e spesso contengono il nome del fornitore o il suo
// dominio. Erano ripuliti in quattro punti diversi, ognuno con la propria lista — e infatti
// all'arrivo del terzo fornitore tre di quei quattro punti sono rimasti scoperti. Lista unica.
const NOMI_FORNITORI = /spediamo\s*pro|spedisci\.?online|core\.spediamopro\.com|easy\s*parcel|api\.easyparcel\.it|\bdva\b/gi

// SVINCOLO GIACENZA: l'errore del corriere arrivava all'utente come JSON grezzo
// ('release : {"processId":"<jmkc…>","error":{"id":"err_…","status":500,…}}') — illeggibile e
// inutile. Qui si estrae la causa e la si traduce in un'indicazione operativa.
export function erroreSvincoloPulito(raw: any): string {
  const s = String(raw?.message ?? raw ?? '')
  let interno = ''
  const j = s.match(/\{[\s\S]*\}/)
  if (j) { try { const o = JSON.parse(j[0]); interno = o?.error?.message || o?.message || '' } catch {} }
  const t = (interno || s).toLowerCase()

  if (/rifiut|refus|respint/.test(t)) {
    return 'Il destinatario ha rifiutato il pacco: la riconsegna non è possibile, richiedi il reso al mittente.'
  }
  if (/non.*trovat|not found|inesistente/.test(t)) {
    return 'Il corriere non trova più questa giacenza (potrebbe essere già stata svincolata o scaduta). Aggiorna la pagina e ricontrolla lo stato.'
  }
  if (/timed\s*out|timeout|0 bytes received/.test(t)) {
    return 'Il corriere non ha risposto in tempo. Riprova tra qualche istante.'
  }
  if (/scadut|expired|termine/.test(t)) {
    return 'I termini di giacenza sono scaduti: il pacco è già in rientro al mittente. Non serve alcuno svincolo.'
  }
  // Il fornitore del contratto V risponde con codici suoi: il credito insufficiente e la
  // spedizione che non e' nostra sono i due casi che capitano davvero, e vanno detti per quello
  // che sono — non come "errore generico, riprova", che manda a sbattere due volte.
  if (/\b120\b/.test(t) && /credit|saldo|fond/.test(t)) {
    return 'Credito insufficiente sul conto del corriere per pagare lo svincolo. Ricarica e riprova.'
  }
  if (/\b16[123]\b/.test(t) || /non appartiene|perimetro/.test(t)) {
    return 'Questa spedizione non risulta gestibile con il contratto usato: controlla che la giacenza sia della spedizione giusta.'
  }
  // Errore lato corriere (500): non è un dato sbagliato nostro, è il suo sistema che rifiuta.
  if (/ha restituito un errore|status.*5\d\d|internal|server error/.test(t)) {
    const vettore = (interno.match(/servizio di ([A-Za-z ]+) ha restituito/i) || [])[1]
    return `Il corriere${vettore ? ' ' + vettore.trim() : ''} ha rifiutato lo svincolo con un errore sui suoi sistemi. Di norma succede quando l'operazione scelta non è ammessa per questa giacenza (es. riconsegna di un pacco rifiutato) oppure per un blocco temporaneo: riprova, o scegli il reso al mittente.`
  }
  const pulito = (interno || s)
    .replace(NOMI_FORNITORI, '').replace(/https?:\/\/\S+/gi, '')
    .replace(/\{[\s\S]*\}/, '').replace(/release\s*:/i, '').replace(/\s{2,}/g, ' ').trim().slice(0, 140)
  return `Svincolo non riuscito sul corriere${pulito ? ': ' + pulito : ''}. Riprova o contatta l'assistenza.`
}

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
  msg = msg.replace(NOMI_FORNITORI, '').replace(/pickup failed[^:]*:?/ig, '').replace(/\s{2,}/g, ' ').trim()
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
      .replace(NOMI_FORNITORI, 'il corriere')
      .replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()
    const spiegazioni = dettagli.map(d => scrub([d?.source, d?.message].filter(Boolean).join(': '))).filter(Boolean).join('; ')
    msg = spiegazioni
      ? `Dati non accettati dal corriere — ${spiegazioni}. Correggi e riprova.`
      : 'Ritiro non disponibile per questa spedizione.'
  }
  return msg
}

// TRACKING: il popup rimandava al browser `e.message` grezzo. I messaggi costruiti in
// lib/spediamopro.ts contengono il NOME DEL PROVIDER per esteso piu' 150 caratteri di corpo della
// risposta (es. 'SpediamoPro tracking (403): {...}'), stampati tali e quali sia nel portale cliente
// sia in quello master. E' la funzione piu' usata dell'elenco spedizioni: ogni errore del provider
// finiva sotto gli occhi del cliente finale.
// Qui l'errore viene tradotto in un'indicazione utile, senza mai nominare il provider.
export function erroreTrackingPulito(raw: any): string {
  const s = String(raw?.message ?? raw ?? '')
  const t = s.toLowerCase()

  if (/\b40[13]\b|forbidden|unauthorized|auth failed|credenziali/.test(t)) {
    return 'Il corriere non sta fornendo il dettaglio del tracking in questo momento. Gli aggiornamenti arrivano comunque in automatico: ricontrolla fra poco.'
  }
  if (/\b404\b|not found|non trovat|inesistente/.test(t)) {
    return 'Il corriere non ha ancora registrato questa spedizione: il tracking compare di norma entro qualche ora dalla presa in carico.'
  }
  if (/timed\s*out|timeout|etimedout|econnreset|network|fetch failed/.test(t)) {
    return 'Il corriere non ha risposto in tempo. Riprova fra qualche istante.'
  }
  if (/\b5\d\d\b|internal|server error|bad gateway/.test(t)) {
    return 'Il sistema del corriere sta segnalando un errore temporaneo. Gli eventi verranno recuperati automaticamente.'
  }
  return 'Dettaglio del tracking non disponibile in questo momento. Gli aggiornamenti arrivano in automatico dal corriere.'
}

// Messaggio pulito quando il corriere rifiuta la spedizione: MAI il nome del provider
// (SpediamoPro/Spedisci.online) né il testo grezzo dell'API. Deduce la causa dai keyword.
export function erroreCorrierePulito(raw: any): string {
  const t = String(raw || '').toLowerCase()
  if (/timed\s*out|timeout|0 bytes received/.test(t))
    return 'Il corriere non ha risposto in tempo (rallentamento momentaneo dei suoi sistemi). Riprova tra qualche istante.'
  if (/\bphone\b|telefono/.test(t))
    return 'Telefono del mittente mancante o non valido: inserisci un numero di telefono (solo cifre) e riprova.'
  if (/dimension|misur|measure|\bsize\b|volume|lato|length|width|height|weight|\bpeso\b|\bkg\b|oversiz|too (large|big|heavy)/.test(t))
    return 'Collo non ammesso dal corriere: verifica misure e peso (potrebbe essere fuori misura).'
  if (/provinc|state|postal|\bzip\b|address|indiriz|\bcap\b|city|citt|recipient|consignee|sender|destinat|mittent/.test(t))
    return 'Indirizzo non valido: controlla nome, indirizzo, città, provincia e CAP di mittente e destinatario.'
  if (/\bcod\b|cash.?on.?delivery|contrassegn/.test(t))
    return 'Contrassegno non gestibile da questo contratto (non previsto o importo oltre il massimo). Rimuovilo o scegli un altro contratto.'
  if (/insur|assicur/.test(t))
    return 'Assicurazione non gestibile da questo contratto (non prevista o valore oltre il massimo).'
  if (/nessuna tariffa|no rate|not available|non disponibile|quotation|service.*not|servizio.*non/.test(t))
    return 'Nessuna tariffa disponibile per questa destinazione con il contratto scelto: prova un altro contratto.'
  if (/auth|token|unauthor|forbidden|credential|credenzial|domain|enotfound|fetch failed|econn|network|master_domain/.test(t))
    return 'Contratto non configurato correttamente (credenziali/dominio mancanti). Contatta l\'assistenza.'
  // Ultima risorsa: messaggio generico, MA con un frammento ripulito della causa (senza nome provider)
  const pulito = String(raw || '').replace(NOMI_FORNITORI, '').replace(/https?:\/\/[^\s]+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return 'Il corriere non può gestire questa spedizione' + (pulito ? ` (${pulito})` : ': verifica misure, peso, indirizzo e servizi, oppure scegli un altro contratto.')
}
