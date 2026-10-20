import crypto from 'crypto'

// QUANDO CI SI FIDA DI UN LINK FIRMATO DA SHOPIFY: IN UN POSTO SOLO.
//
// Shopify apre l'app su /api/integrazioni/shopify/enter e torna dall'OAuth su /callback con parametri
// firmati nell'indirizzo: shop, host, timestamp, hmac (piu' code e state al ritorno). Fino al 20/10/2026
// le due rotte avevano ciascuna la sua copia della verifica, e nessuna guardava il timestamp: la firma dice
// chi ha fatto il link, non quando. Cosi' lo stesso indirizzo di /enter riapriva il portale del negoziante
// per sempre, finche' il negozio restava collegato: chi lo ritrovava in una cronologia, in un log o in uno
// screenshot entrava nel conto, col credito e i dati dei compratori. Shopify lo scrive come motivo di
// rifiuto: "tokens that don't expire ... your app will be rejected" (https://shopify.dev/docs/apps/build/security).
//
// Firma e tempo escono INSIEME da una funzione sola: chi la chiama riceve 'scaduto' e deve decidere cosa
// farne, non puo' dimenticarsi di chiederlo. E' la forma della libreria ufficiale di Shopify, dove la
// verifica della firma guarda anche il timestamp (@shopify/shopify-api, lib/utils/hmac-validator.ts).

// 90 secondi: la tolleranza della libreria ufficiale per questi stessi parametri
// (HMAC_TIMESTAMP_PERMITTED_CLOCK_TOLERANCE_SEC). Shopify firma il link quando rimanda il negoziante da noi:
// fra la firma e questo controllo passano la rete e lo scarto fra gli orologi. Una finestra stretta non
// chiude fuori il negoziante, che riaprendo l'app dall'admin del negozio riceve un link nuovo; accorcia solo
// il tempo in cui un link rubato vale qualcosa.
// Tutto questo regge se il link con cui Shopify apre l'app porta il timestamp in SECONDI, preso al clic: la
// guida lo mette fra i parametri della richiesta all'App URL, con un esempio in secondi, e la libreria
// ufficiale lo pretende. Se mancasse o fosse in millisecondi, ogni apertura finirebbe su link_scaduto (in
// /enter: «link scaduto ANOMALO»), anche quella di chi installa; se fosse preso al caricamento della pagina
// App, ci finirebbe chi aspetta piu' di 90 secondi prima di cliccare. Per questo si guarda su un'apertura
// vera dal dev store prima di rilasciare. Prova sul dev store: <DATA DELLA PROVA SUL DEV STORE>.
const TOLLERANZA_FIRMA_SEC = 90

export type EsitoLinkShopify =
  | { esito: 'valido'; scartoSec: number }
  // scartoSec null: timestamp mancante, ripetuto o non intero
  | { esito: 'scaduto'; scartoSec: number | null }
  | { esito: 'firma_falsa'; scartoSec: null }

// Prima la firma, poi il tempo: un link che Shopify non ha firmato resta 'firma_falsa' qualunque data porti,
// come prima. Il suo timestamp non dice niente finche' la firma non prova che l'ha scritto Shopify.
export function verificaLinkShopify(sp: URLSearchParams, secret: string, oraMs: number = Date.now()): EsitoLinkShopify {
  if (!firmaValida(sp, secret)) return { esito: 'firma_falsa', scartoSec: null }
  // Mancante, ripetuto o non intero: la libreria ufficiale in questi casi rifiuta, e cosi' qui.
  const valori = sp.getAll('timestamp')
  const ts = valori.length === 1 ? Number(valori[0]) : NaN
  if (!Number.isInteger(ts)) return { esito: 'scaduto', scartoSec: null }
  // In valore assoluto: non vale nemmeno un timestamp nel futuro oltre la tolleranza (orologio di chi
  // firma avanti, o un link fatto apposta con una data lontana).
  const scartoSec = Math.trunc(oraMs / 1000) - ts
  return Math.abs(scartoSec) <= TOLLERANZA_FIRMA_SEC ? { esito: 'valido', scartoSec } : { esito: 'scaduto', scartoSec }
}

// La firma HMAC: tutti i parametri tranne hmac e signature, ordinati, chiave=valore uniti da &, SHA-256 col
// client secret, confronto a tempo costante. Il timestamp e' dentro la firma: non si puo' togliere ne'
// ritoccare senza invalidarla. E' la verifica di prima, riga per riga: spostarla qui non cambia quali
// link passano.
function firmaValida(sp: URLSearchParams, secret: string): boolean {
  const hmac = sp.get('hmac') || ''
  const entries: string[] = []
  sp.forEach((v, k) => { if (k !== 'hmac' && k !== 'signature') entries.push(`${k}=${v}`) })
  entries.sort()
  const digest = crypto.createHmac('sha256', secret).update(entries.join('&')).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex')) } catch { return false }
}
