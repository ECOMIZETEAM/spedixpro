// UNA RICHIESTA SOLA QUANDO DUE COMPONENTI CHIEDONO LA STESSA COSA NELLO STESSO MOMENTO.
//
// Nel portale ci sono coppie di componenti montati insieme che leggono la stessa rotta, ciascuno per
// conto suo: la campanella e il riquadro avvisi della home cliente (/api/notifiche/mie), il blocco del
// canone e il banner del piano su ogni pagina del master (/api/piano/stato). A ogni apertura di pagina
// partivano due richieste identiche, ognuna con la sua autenticazione e le sue letture sul database
// (misurato il 13/10/2026: circa 10.000 doppioni al giorno solo sullo stato del piano).
//
// NON E' UNA CACHE. La risposta si condivide soltanto finche' la richiesta e' in volo: appena arriva,
// la si dimentica, e la lettura successiva riparte da zero e vede i dati di quel momento — come prima.
// Gli errori arrivano a tutti e due gli interessati, ognuno nel suo catch, come prima.
//
// Il dato arriva a piu' componenti come lo STESSO oggetto: chi lo usa non deve modificarlo sul posto
// (niente sort/push/splice sul risultato). Verificato sui quattro chiamanti di oggi.
const inVolo = new Map<string, Promise<any>>()

export function leggiCondiviso(url: string): Promise<any> {
  const gia = inVolo.get(url)
  if (gia) return gia
  const richiesta = fetch(url)
    .then(r => r.json())
    .finally(() => { inVolo.delete(url) })
  inVolo.set(url, richiesta)
  return richiesta
}
