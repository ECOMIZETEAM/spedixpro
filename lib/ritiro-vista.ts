// COME SI MOSTRA UN RITIRO: lo stato a parole e il link alla pagina del corriere. Lo usano le tre
// liste (Ritiri, Elenco Ritiri, Ritiri del cliente), quindi qui niente che giri solo sul server.

// GLI STATI. 'richiesto' e' il punto di partenza di tutti i contratti; gli altri li scrive solo il
// ritiro letto dal fornitore (oggi SpediamoPro, vedi statoRitiroSpediamopro). 'elaborato' e
// 'completato' sono parole vecchie: restano sulle righe gia' scritte e si leggono ancora.
export const STATI_RITIRO: Record<string, { label: string; bg: string; color: string; nota?: string }> = {
  richiesto: { label: 'Richiesto', bg: '#fff7ed', color: '#f97316' },
  prenotato: { label: 'In lavorazione', bg: '#eff6ff', color: '#2563eb' },
  confermato: { label: 'Confermato dal corriere', bg: '#eff6ff', color: '#1d4ed8', nota: 'Il corriere ha preso in carico la prenotazione. Su alcuni ritiri il corriere non comunica il passaggio: se il ritiro è di ieri, guarda lo stato delle spedizioni.' },
  rimandato: { label: 'Rimandato', bg: '#fffbeb', color: '#b45309', nota: 'Il corriere ha rimandato il ritiro (per esempio merce non pronta).' },
  ritirato: { label: 'Ritirato', bg: '#f0fdf4', color: '#16a34a' },
  annullato: { label: 'Annullato', bg: '#fef2f2', color: '#dc2626', nota: 'Questa prenotazione è stata annullata. Se il pacco è ancora fermo, la spedizione è di nuovo tra quelle da ritirare: richiedi un nuovo ritiro.' },
  // Su 563 ritiri annullati dal corriere in 30 giorni (al 25/11/2026) 422 pacchi erano partiti lo stesso, con
  // un altro passaggio: la parola da sola spaventava. I 102 rimasti fermi sono quelli da rifare, e tornano
  // ritirabili (STATI_RITIRO_ANNULLATI qui sotto).
  annullato_corriere: { label: 'Annullato dal corriere', bg: '#fef2f2', color: '#dc2626', nota: 'Il corriere ha annullato questa prenotazione (per esempio nessuno all’indirizzo o merce non pronta). Spesso il pacco parte lo stesso con un altro passaggio: controlla lo stato della spedizione. Se è ferma, è di nuovo tra quelle da ritirare: richiedi un nuovo ritiro.' },
  errore: { label: 'Rifiutato dal corriere', bg: '#fef2f2', color: '#dc2626', nota: 'Il corriere non ha accettato la prenotazione. Se il pacco è ancora fermo, la spedizione è di nuovo tra quelle da ritirare: richiedi un nuovo ritiro.' },
  elaborato: { label: 'Elaborato', bg: '#f0fdf4', color: '#16a34a' },
  completato: { label: 'Completato', bg: '#f0fdf4', color: '#16a34a' },
}

// UN RITIRO CHE NON PASSERA' PIU': la spedizione legata a lui si puo' ritirare di nuovo (Nuovo ritiro e API
// /pickups). La spedizione resta legata al ritiro annullato finche' non ne nasce uno nuovo: lo storico non si
// perde. Decisione di Lorenzo del 25/11/2026.
export const STATI_RITIRO_ANNULLATI = ['annullato', 'annullato_corriere', 'errore']

export function statoRitiroVisto(stato: string | null | undefined): { label: string; bg: string; color: string; nota?: string } {
  return STATI_RITIRO[String(stato || '')] || { label: String(stato || '—'), bg: '#f3f4f6', color: '#6b7280' }
}

// IL LINK AL CORRIERE. BRT ha una pagina pubblica per ogni prenotazione di ritiro, col "numero
// prenotazione ritiro" (tre lettere e sette cifre, es. CUR4448310) e gli eventi: confermato, in ritiro,
// ritirato. Si apre con i codici di tutti i fornitori dei contratti BRT (provato il 25/11/2026 su
// SpediamoPro, DVA e Spedisci; un codice inventato risponde "non trovato").
// POSTE: la pagina dei ritiri di poste.it ("Cerca Ritiri", trovata da Lorenzo il 25/11/2026) riconosce i codici
// CP… di tutti i fornitori (provati SDA EXPRESS L, Poste V di DVA, PDB EASY di Spedisci, PDB L di Dielle, PDB S di
// SpediamoPro; un codice inventato risponde "La ricerca non ha prodotto risultati"). Non legge pero' il codice
// dall'indirizzo e si apre sempre con la casella vuota: il link lo copia, e si incolla. (La ricerca delle
// SPEDIZIONI di poste.it invece non li conosce: li' un codice vero e uno inventato rispondono uguale.)
export type LinkRitiro = { url: string; corriere: 'BRT' | 'Poste'; copiaCodice: boolean }
export function linkRitiroCorriere(codice: string | null | undefined, nomeContratto: string | null | undefined): LinkRitiro | null {
  const c = String(codice || '').trim()
  if (/^[A-Z]{3}\d{7}$/.test(c) && /brt/i.test(String(nomeContratto || ''))) {
    return { url: `https://vas.brt.it/vas/orm_det_show.htm?npr=${c}`, corriere: 'BRT', copiaCodice: false }
  }
  if (/^CP\d{9}$/.test(c)) return { url: 'https://www.poste.it/prenota-ritiri/index.html', corriere: 'Poste', copiaCodice: true }
  return null
}
