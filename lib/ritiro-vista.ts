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
  annullato: { label: 'Annullato', bg: '#fef2f2', color: '#dc2626' },
  // Su 563 ritiri annullati dal corriere in 30 giorni (al 25/11/2026) 422 pacchi erano partiti lo stesso, con
  // un altro passaggio: la parola da sola spaventava. I 102 rimasti fermi sono quelli da rifare.
  annullato_corriere: { label: 'Annullato dal corriere', bg: '#fef2f2', color: '#dc2626', nota: 'Il corriere ha annullato questa prenotazione (per esempio nessuno all’indirizzo o merce non pronta). Spesso il pacco parte lo stesso con un altro passaggio: controlla lo stato della spedizione, e se è ferma contatta l’assistenza.' },
  errore: { label: 'Rifiutato dal corriere', bg: '#fef2f2', color: '#dc2626', nota: 'Il corriere non ha accettato la prenotazione: controlla lo stato della spedizione, e se è ferma contatta l’assistenza.' },
  elaborato: { label: 'Elaborato', bg: '#f0fdf4', color: '#16a34a' },
  completato: { label: 'Completato', bg: '#f0fdf4', color: '#16a34a' },
}

export function statoRitiroVisto(stato: string | null | undefined): { label: string; bg: string; color: string; nota?: string } {
  return STATI_RITIRO[String(stato || '')] || { label: String(stato || '—'), bg: '#f3f4f6', color: '#6b7280' }
}

// IL LINK AL CORRIERE. BRT ha una pagina pubblica per ogni prenotazione di ritiro, col "numero
// prenotazione ritiro" (tre lettere e sette cifre, es. CUR4448310) e gli eventi: confermato, in ritiro,
// ritirato. Si apre con i codici di tutti i fornitori dei contratti BRT (provato il 25/11/2026 su
// SpediamoPro, DVA e Spedisci; un codice inventato risponde "non trovato").
// Poste no: la ricerca pubblica di poste.it non conosce i codici di ritiro CP… — un codice vero e uno
// inventato danno la stessa risposta vuota (25/11/2026). Un link li' mostrerebbe sempre "nessuna informazione".
export function linkRitiroCorriere(codice: string | null | undefined, nomeContratto: string | null | undefined): string | null {
  const c = String(codice || '').trim()
  if (!/^[A-Z]{3}\d{7}$/.test(c) || !/brt/i.test(String(nomeContratto || ''))) return null
  return `https://vas.brt.it/vas/orm_det_show.htm?npr=${c}`
}
