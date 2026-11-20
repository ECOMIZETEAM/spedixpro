/* RICHIESTE ANTICIPATE, nel browser.
 *
 * anticipa / prendiAnticipata: una pagina fa partire SUBITO le chiamate dei riquadri che disegnera'
 * dopo, invece di lasciarle partire al loro montaggio. Serve alla home del master: i riquadri
 * (guadagno e gli altri report) si montano solo quando /api/dashboard ha risposto, quindi le loro
 * chiamate partivano in una seconda ondata, in fila alla prima (il 19/10/2026 ~950 aperture, guadagno
 * mediana 1,47 s). Il riquadro, al montaggio, prende la risposta gia' partita per lo STESSO
 * indirizzo; se non c'e' (un'altra pagina, un altro periodo scelto, scaduta) chiama da se' come
 * prima. Ogni risposta anticipata si usa una volta sola: chi la prende ne legge il corpo.
 * (Due componenti che chiedono INSIEME lo stesso indirizzo usano invece lib/richiesta-condivisa.) */

const VALIDITA_ANTICIPATA_MS = 30_000

const anticipate = new Map<string, { alle: number; risposta: Promise<Response> }>()

export function anticipa(url: string, init?: RequestInit): void {
  const c = anticipate.get(url)
  if (c && Date.now() - c.alle < VALIDITA_ANTICIPATA_MS) return
  const risposta = fetch(url, init)
  // Se nessuno la prende (la pagina ha poi mostrato un errore), un rifiuto non deve finire in console
  // come "non gestito": chi la prende gestisce il suo.
  risposta.catch(() => {})
  anticipate.set(url, { alle: Date.now(), risposta })
}

// La risposta anticipata per QUESTO indirizzo, se c'e' ed e' fresca; altrimenti null e si chiama.
export function prendiAnticipata(url: string): Promise<Response> | null {
  const c = anticipate.get(url)
  if (!c) return null
  anticipate.delete(url)
  return Date.now() - c.alle < VALIDITA_ANTICIPATA_MS ? c.risposta : null
}
