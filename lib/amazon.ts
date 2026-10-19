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

// Autorizzazione partita DAL NOSTRO PORTALE (pagina Integrazioni → Amazon).
export function amazonAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({ application_id: process.env.AMAZON_SPAPI_APP_ID || '', state })
  if (process.env.AMAZON_SPAPI_BETA === '1') p.set('version', 'beta')
  return `${CONSENSO_EU}?${p.toString()}`
}

// I domini di Amazon, ancorati alla fine del nome: "amazon." da solo non basta, perche'
// amazon.attacker.example o sellercentral.amazon.it.evil.com lo contengono anche loro.
const DOMINIO_AMAZON = /^(?:[a-z0-9-]+\.)*amazon\.(?:com|it|de|fr|es|co\.uk|nl|se|pl|com\.be|ie|com\.tr)$/i

// Autorizzazione partita DALL'APPSTORE (o rinnovo): Amazon chiama la nostra pagina di accesso con
// `amazon_callback_uri` e `amazon_state`; noi, riconosciuto il cliente, rimandiamo ad Amazon lo
// stato suo e il nostro. Si accetta SOLO la pagina di conferma di Amazon: quel parametro arriva
// da fuori, e accettarne uno qualunque farebbe del nostro dominio un rimando verso siti terzi con
// in mano uno `state` valido. `version=beta` si rimanda se e solo se l'ha mandato Amazon.
export function amazonCallbackAppstore(amazonCallbackUri: string, amazonState: string, state: string, versione: string | null): string | null {
  let u: URL
  try { u = new URL(amazonCallbackUri) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!DOMINIO_AMAZON.test(u.hostname) || !u.pathname.startsWith('/apps/authorize/confirm/')) return null
  u.searchParams.set('amazon_state', amazonState)
  u.searchParams.set('state', state)
  if (versione === 'beta') u.searchParams.set('version', 'beta')
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
// giorni). Non e' un guasto passeggero: l'integrazione va chiusa e i dati dei suoi ordini
// cancellati (Data Protection Policy §1.7) — lo fa cancellaDatiAmazon.
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
// `sync` (cursore degli aggiornamenti, lettura da riprendere) si conserva a un ricollegamento: senza,
// il primo giro dopo il rinnovo annuale non vedrebbe gli annulli e le spedizioni del frattempo.
export function credenzialiAmazon(x: { sellerId: string; refreshToken: string; accessToken: string; expiresIn: number; syncPrecedente?: any }) {
  return {
    selling_partner_id: x.sellerId,
    marketplace_id: MARKETPLACE_IT,
    refresh_token_cifrato: cifra(x.refreshToken),
    access_token_cifrato: cifra(x.accessToken),
    expires_at: Date.now() + x.expiresIn * 1000,
    ...(x.syncPrecedente ? { sync: x.syncPrecedente } : {}),
  }
}

// SCRITTURA CONFRONTATA delle credenziali. Le scrivono in tre (rinnovo del token, fine di una
// sincronizzazione, ricollegamento) e ognuno parte da una copia letta prima: chi scrive per ultimo
// riscriverebbe tutto da una copia vecchia. Qui si rilegge la riga, si applica la sola modifica, e
// si scrive solo se il refresh token e' ancora quello (non cambia ai rinnovi, cambia solo a un
// ricollegamento): se nel frattempo il venditore ha ricollegato l'account, non si tocca niente.
export async function aggiornaCredenzialiAmazon(admin: any, integr: any, modifica: (cred: any) => any): Promise<boolean> {
  const { data: riga } = await admin.from('integrazioni').select('credenziali').eq('id', integr.id).maybeSingle()
  const attuali = (riga?.credenziali || {}) as any
  const atteso = (integr.credenziali || {}).refresh_token_cifrato
  if (!attuali.refresh_token_cifrato || attuali.refresh_token_cifrato !== atteso) return false
  const nuove = modifica(attuali)
  const { data, error } = await admin.from('integrazioni').update({ credenziali: nuove })
    .eq('id', integr.id).eq('credenziali->>refresh_token_cifrato', atteso).select('id')
  if (error || !(data || []).length) return false
  integr.credenziali = nuove
  return true
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
  const accesso = cifra(d.access_token)
  const scade = ora + (Number(d.expires_in) || 3600) * 1000
  const scritto = await aggiornaCredenzialiAmazon(db, integr, attuali => ({
    ...attuali,
    refresh_token_cifrato: cifrataConChiaveAttuale(attuali.refresh_token_cifrato) ? attuali.refresh_token_cifrato : cifra(refresh),
    access_token_cifrato: accesso,
    expires_at: scade,
  }))
  // Non scritto = il venditore ha ricollegato nel frattempo: il token appena avuto e' comunque
  // valido per questo giro; il prossimo leggera' le credenziali nuove.
  if (!scritto) integr.credenziali = { ...cred, access_token_cifrato: accesso, expires_at: scade }
  return d.access_token
}

// L'autorizzazione e' stata revocata: si chiude l'integrazione (solo se il token che ha fallito e'
// ancora quello salvato: un ricollegamento appena fatto non si chiude) e si cancellano i dati.
export async function chiudiIntegrazioneAmazon(admin: any, integr: any, motivo: string): Promise<void> {
  const atteso = (integr.credenziali || {}).refresh_token_cifrato
  if (!atteso) return
  const { data } = await admin.from('integrazioni').update({ stato: 'disconnesso', errore: motivo })
    .eq('id', integr.id).eq('credenziali->>refresh_token_cifrato', atteso).select('id')
  if ((data || []).length) await cancellaDatiAmazon(admin, integr.id)
}

// CANCELLAZIONE DEI DATI DI UN ACCOUNT AMAZON che non e' piu' collegato (scollegato dal cliente o
// autorizzazione revocata). La Data Protection Policy (§1.7) vuole cancellate le informazioni
// Amazon entro 30 giorni: qui si fa subito.
//  - Gli ordini MAI spediti da noi si eliminano: sono solo una copia dei dati di Amazon, e senza
//    collegamento nessuno li spedira' piu' da qui (al ricollegamento tornano quelli ancora aperti).
//  - Gli ordini spediti da noi restano agganciati alla loro spedizione (lo storico non si
//    cancella), ma senza dati del compratore e senza la copia di Amazon.
export async function cancellaDatiAmazon(admin: any, integrazioneId: string): Promise<void> {
  const { error: e1 } = await admin.from('ordini_ecommerce').delete()
    .eq('integrazione_id', integrazioneId).eq('piattaforma', 'amazon').is('spedizione_id', null)
  const { error: e2 } = await admin.from('ordini_ecommerce').update({ destinatario: null, raw: null, cliente_nome: null })
    .eq('integrazione_id', integrazioneId).eq('piattaforma', 'amazon').not('spedizione_id', 'is', null)
  if (e1 || e2) console.error('[AMAZON] cancellazione dati account non riuscita:', (e1 || e2).message)
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
