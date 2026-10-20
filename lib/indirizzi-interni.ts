// INDIRIZZI EMAIL INVENTATI DA NOI: si costruiscono e si riconoscono SOLO qui.
//
// Due tipi di conto hanno un indirizzo che non e' di nessuno: il conto che nasce quando un negozio
// installa l'app Shopify (serve solo all'accesso automatico, il negoziante non lo digita mai) e il
// conto-ledger di una condivisione fra master (non ha nemmeno un accesso). Fino al 20/10/2026 nascevano
// su moovexpress.app, un dominio che NON e' nostro: il registro .app rispondeva 404 e il DNS non
// esisteva, quindi chiunque poteva comprarlo e ricevere le email dirette a quei conti, compreso il
// link di recupero della password. Ora nascono su sottodomini di moovexpress.com, il cui DNS e' nostro
// (Vercel): un record jolly e la posta (Google) solo sul dominio principale.
//
// Il dominio vecchio resta riconosciuto, tutto, apex compreso. Il 20/10 i 3 conti Shopify di luglio
// sono stati spostati sul sottodominio nuovo, ma su moovexpress.app restano 6 ledger e 1 cliente di
// prova scritto a mano (DL-TEST di LOGIXIA): finche' esistono, le regole qui sotto valgono anche per
// loro. Sul dominio vecchio invece non si cerca piu' nessun conto Shopify: non ce n'e' rimasto nessuno.

const DOMINIO_SHOPIFY = 'shopify.moovexpress.com'
const DOMINIO_LEDGER = 'ledger.moovexpress.com'
const DOMINIO_VECCHIO = 'moovexpress.app'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const dominioDi = (email: string | null | undefined): string => {
  const e = String(email || '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  return at < 0 ? '' : e.slice(at + 1)
}

// L'indirizzo del conto creato all'installazione di un negozio Shopify: e' anche la chiave con cui
// lo si ritrova se la riga dell'integrazione sparisce (shop/redact).
export function emailContoShopify(shop: string): string {
  return `${shop.trim().toLowerCase().replace(/\.myshopify\.com$/, '')}@${DOMINIO_SHOPIFY}`
}

// L'indirizzo del conto-ledger di una condivisione.
export function emailContoLedger(condivisioneId: string): string {
  return `ledger-${condivisioneId}@${DOMINIO_LEDGER}`
}

// Vero per gli indirizzi inventati da noi: i due sottodomini ESATTI e tutto moovexpress.app. Falso per
// le caselle vere di moovexpress.com (info@, noreply@, demo-...@) e per i domini che solo somigliano.
export function eIndirizzoInterno(email: string | null | undefined): boolean {
  const d = dominioDi(email)
  return d === DOMINIO_SHOPIFY || d === DOMINIO_LEDGER || d === DOMINIO_VECCHIO || d.endsWith('.' + DOMINIO_VECCHIO)
}

// L'indirizzo a cui una persona puo' davvero rispondere o ricevere qualcosa: valido e non inventato da
// noi. Per gli altri undefined, cosi' chi lo passa a un servizio esterno (replyTo, cliente Stripe) non
// manda niente invece di mandare un indirizzo che nessuno legge.
export function recapitoEmail(email: string | null | undefined): string | undefined {
  const e = String(email || '').trim().toLowerCase()
  return EMAIL_RE.test(e) && !eIndirizzoInterno(e) ? e : undefined
}
