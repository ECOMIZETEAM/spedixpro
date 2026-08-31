// Un numero "provvisorio" è un segnaposto INTERNO che il corriere non ha ancora trasformato in
// lettera di vettura vera. Alla creazione easyparcel/DVA parte su "TMP-<ordine>", altri rami su
// "SP-"/"DVA-": il numero definitivo lo assegna il provider in modo asincrono e il cron
// tracking/aggiorna (e la rotta etichetta) lo sostituiscono appena disponibile.
//
// Perché esiste questo file: "TMP-25871575" era finito SOTTO GLI OCCHI DEL CLIENTE in lista
// spedizioni — non è professionale, non è tracciabile, e non è il codice che va in etichetta.
// Fino a quando il numero è provvisorio NON si mostra il codice grezzo: si mostra uno stato
// ("LDV in elaborazione"). La regola sta qui, in un posto solo, così ogni pagina la applica uguale.
export const PREFISSI_LDV_PROVVISORIA = /^(TMP|SP|DVA)-/i

// SpediamoPro (Poste PDB / BRT via SpediamoPro) non usa un prefisso "SP-": alla creazione il numero
// cade sul `code` del provider, che è "6A" + esadecimale (es. 6A9538E356AF1). La LDV Poste vera è
// "050...". Finché il numero è ancora quel code è PROVVISORIO come gli altri: se non lo trattiamo così,
// al cliente esce "6A9538E356AF1" — un tracking che su Poste non esiste. (Ancorato ^…$ per non
// intercettare per sbaglio una LDV vera che contenga quei caratteri.)
export const CODICE_SPEDIAMOPRO_PROVVISORIO = /^6A[0-9A-F]{8,}$/i

export function ldvProvvisoria(numero?: string | null): boolean {
  const n = String(numero || '')
  return PREFISSI_LDV_PROVVISORIA.test(n) || CODICE_SPEDIAMOPRO_PROVVISORIO.test(n)
}

// Etichetta di stato da mostrare all'utente quando il numero è ancora provvisorio.
export const LDV_IN_ELABORAZIONE = 'LDV in elaborazione'

// Numero da mostrare in UI: quello vero, oppure lo stato se ancora provvisorio.
export function numeroVisibile(numero?: string | null): string {
  return ldvProvvisoria(numero) ? LDV_IN_ELABORAZIONE : String(numero || '')
}
