import { cifra, decifra, cifraturaConfigurata, cifrataConChiaveAttuale } from '@/lib/cifratura-integrazioni'

// AMAZON SELLING PARTNER API (SP-API) — collegamento diretto degli account venditore.
//
// Regione Europa, marketplace Italia, solo ordini spediti dal venditore (FBM): niente FBA.
// Il venditore autorizza la nostra app da Seller Central; Amazon ci da' un refresh token per quel
// venditore, che salviamo CIFRATO (lib/cifratura-integrazioni) e con cui chiediamo un token
// d'accesso da un'ora alla volta.
//
// Riferimenti verificati sulla documentazione Amazon il 19/10/2026 (developer-docs.amazon/sp-api):
// marketplace Italia APJ6JRA9NG5V4 (A1PA6795UKMFR9 e' la Germania); niente firma AWS dal 2/10/2023;
// lo `user-agent` e' obbligatorio. Un'app NON pubblicata sull'Appstore la possono autorizzare al
// massimo 25 venditori, e il venditore rinnova l'autorizzazione ogni 365 giorni.
//
// Variabili d'ambiente (Vercel, mai in chat):
//   AMAZON_SPAPI_APP_ID          id dell'applicazione (amzn1.sellerapps.app.…)
//   AMAZON_SPAPI_CLIENT_ID       credenziali LWA dell'app
//   AMAZON_SPAPI_CLIENT_SECRET
//   AMAZON_SPAPI_BETA=1          finche' l'app e' in bozza (non pubblicata sull'Appstore)
//   INTEGRAZIONI_CHIAVI_CIFRATURA  chiave che cifra i token (senza, il collegamento non parte)

const LWA_TOKEN = 'https://api.amazon.com/auth/o2/token'
export const SPAPI_EU = 'https://sellingpartnerapi-eu.amazon.com'
export const MARKETPLACE_IT = 'APJ6JRA9NG5V4'
const CONSENSO_EU = 'https://sellercentral-europe.amazon.com/apps/authorize/consent'

export function amazonConfigurato(): boolean {
  return !!(process.env.AMAZON_SPAPI_APP_ID && process.env.AMAZON_SPAPI_CLIENT_ID && process.env.AMAZON_SPAPI_CLIENT_SECRET)
    && cifraturaConfigurata()
}

// L'indirizzo di ritorno registrato sull'app Amazon: lo scambio del codice lo vuole IDENTICO.
export function amazonRedirectUri(): string {
  return `${process.env.SHOPIFY_APP_URL || 'https://moovexpress.com'}/api/integrazioni/amazon/callback`
}

const bozza = () => process.env.AMAZON_SPAPI_BETA === '1'

// Autorizzazione partita DAL NOSTRO PORTALE (pagina Integrazioni → Amazon).
export function amazonAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({ application_id: process.env.AMAZON_SPAPI_APP_ID || '', state })
  if (bozza()) p.set('version', 'beta')
  return `${CONSENSO_EU}?${p.toString()}`
}

// Autorizzazione partita DALL'APPSTORE: Amazon chiama la nostra pagina di accesso con
// `amazon_callback_uri` e `amazon_state`; noi, riconosciuto il cliente, gli rimandiamo lo stato
// suo e il nostro. Si accetta solo un indirizzo di Amazon: e' il punto da cui passa il ritorno,
// e un parametro qualunque lo trasformerebbe in un rimando verso siti terzi.
export function amazonCallbackAppstore(amazonCallbackUri: string, amazonState: string, state: string): string | null {
  let u: URL
  try { u = new URL(amazonCallbackUri) } catch { return null }
  if (u.protocol !== 'https:' || !/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return null
  u.searchParams.set('amazon_state', amazonState)
  u.searchParams.set('state', state)
  if (bozza()) u.searchParams.set('version', 'beta')
  return u.toString()
}

async function lwa(campi: Record<string, string>): Promise<any> {
  const res = await fetch(LWA_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      ...campi,
      client_id: process.env.AMAZON_SPAPI_CLIENT_ID || '',
      client_secret: process.env.AMAZON_SPAPI_CLIENT_SECRET || '',
    }),
  })
  const d = await res.json().catch(() => ({}))
  // Il messaggio non deve mai contenere il token: si riporta solo il codice d'errore di Amazon.
  if (d?.error === 'invalid_grant') throw new AutorizzazioneAmazonRevocata()
  if (!res.ok || !d.access_token) throw new Error(`accesso Amazon rifiutato (${res.status} ${d.error || ''})`.trim())
  return d
}

// Il venditore ha tolto l'autorizzazione da Seller Central (o e' scaduta: si rinnova ogni 365
// giorni). Non e' un guasto passeggero: l'integrazione va chiusa, e i dati dei suoi ordini
// cancellati entro 30 giorni (Data Protection Policy §1.7) — lo fa il cron purge-pii.
export class AutorizzazioneAmazonRevocata extends Error {
  constructor() { super('Amazon: autorizzazione revocata o scaduta, ricollega l\'account') }
}

// Codice del ritorno da Seller Central → token. Il codice vale cinque minuti e una volta sola.
export async function amazonScambiaCodice(codice: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const d = await lwa({ grant_type: 'authorization_code', code: codice, redirect_uri: amazonRedirectUri() })
  if (!d.refresh_token) throw new Error('Amazon non ha restituito il refresh token')
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_in: Number(d.expires_in) || 3600 }
}

// Le credenziali come si salvano su integrazioni.credenziali: i due token cifrati, mai in chiaro.
export function credenzialiAmazon(x: { sellerId: string; refreshToken: string; accessToken: string; expiresIn: number }) {
  return {
    selling_partner_id: x.sellerId,
    marketplace_id: MARKETPLACE_IT,
    refresh_token_cifrato: cifra(x.refreshToken),
    access_token_cifrato: cifra(x.accessToken),
    expires_at: Date.now() + x.expiresIn * 1000,
  }
}

// Token d'accesso valido per l'integrazione: quello salvato se ha ancora piu' di 5 minuti, se no
// se ne chiede uno nuovo col refresh token. A ogni rinnovo le credenziali si riscrivono con la
// chiave di cifratura attuale: e' cosi' che una rotazione della chiave arriva su tutte le righe.
export async function tokenAmazon(db: any, integr: any): Promise<string> {
  const cred = (integr.credenziali || {}) as any
  if (!cred.refresh_token_cifrato) throw new Error('Amazon: autorizzazione mancante, ricollega l\'account')
  const ora = Date.now()
  if (cred.access_token_cifrato && Number(cred.expires_at) - ora > 5 * 60 * 1000 && cifrataConChiaveAttuale(cred.access_token_cifrato)) {
    return decifra(cred.access_token_cifrato)
  }
  const refresh = decifra(cred.refresh_token_cifrato)
  const d = await lwa({ grant_type: 'refresh_token', refresh_token: refresh })
  const nuove = {
    ...cred,
    refresh_token_cifrato: cifrataConChiaveAttuale(cred.refresh_token_cifrato) ? cred.refresh_token_cifrato : cifra(refresh),
    access_token_cifrato: cifra(d.access_token),
    expires_at: ora + (Number(d.expires_in) || 3600) * 1000,
  }
  await db.from('integrazioni').update({ credenziali: nuove }).eq('id', integr.id)
  integr.credenziali = nuove
  return d.access_token
}

const attesa = (ms: number) => new Promise(r => setTimeout(r, ms))

// Amazon ha detto "troppe chiamate" e i tentativi sono finiti. Chi legge gli ordini la usa per
// fermarsi e riprendere al giro dopo, invece di perdere quello che ha gia' letto.
export class LimiteAmazon extends Error {
  constructor(operazione: string) { super(`Amazon: limite di chiamate raggiunto (${operazione}), si riprende al prossimo giro`) }
}

// Una chiamata SP-API. Amazon limita le chiamate per operazione e per venditore: a un 429 si
// aspetta e si riprova (attesa crescente, `tentativi` volte), poi si alza LimiteAmazon.
export async function spapi(token: string, metodo: 'GET' | 'POST', percorso: string,
  opz: { query?: Record<string, string | undefined>; corpo?: any; tentativi?: number } = {}): Promise<any> {
  const { query, corpo, tentativi = 4 } = opz
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString() : ''
  const url = `${SPAPI_EU}${percorso}${qs ? '?' + qs : ''}`
  for (let tentativo = 0; ; tentativo++) {
    const res = await fetch(url, {
      method: metodo,
      headers: {
        'x-amz-access-token': token,
        'x-amz-date': new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
        'user-agent': 'MoovExpress/1.0 (Language=TypeScript; Platform=Vercel)',
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    })
    if (res.status === 429) {
      if (tentativo >= tentativi) throw new LimiteAmazon(percorso)
      await attesa(Math.min(2000 * 2 ** tentativo, 20000))
      continue
    }
    const testo = await res.text()
    let d: any = null
    try { d = testo ? JSON.parse(testo) : null } catch { d = null }
    if (!res.ok) {
      // Solo codice e messaggio di Amazon: mai il corpo intero, che puo' contenere dati del compratore.
      const e = Array.isArray(d?.errors) ? d.errors[0] : null
      throw new Error(`Amazon ${res.status}${e?.code ? ' ' + e.code : ''}${e?.message ? ': ' + String(e.message).slice(0, 200) : ''}`)
    }
    return d
  }
}

// Nome del negozio del venditore, per riconoscere l'account nella lista. Best-effort.
export async function amazonNomeNegozio(accessToken: string): Promise<string | null> {
  try {
    const d = await spapi(accessToken, 'GET', '/sellers/v1/marketplaceParticipations', { tentativi: 1 })
    const voci: any[] = d?.payload || []
    const it = voci.find(v => v?.marketplace?.id === MARKETPLACE_IT) || voci[0]
    return it?.storeName || null
  } catch { return null }
}
