// Helper TikTok Shop Open API (OAuth 2.0 con refresh + richieste firmate HMAC-SHA256).
// Docs: https://partner.tiktokshop.com/docv2  — Order API 202309, Fulfillment API 202309.
import crypto from 'crypto'

const AUTH_BASE = 'https://auth.tiktok-shops.com'                 // token get/refresh
const AUTHORIZE_BASE = 'https://services.tiktokshop.com'         // pagina di autorizzazione seller
export const TIKTOK_API = 'https://open-api.tiktokglobalshop.com' // API business (firmate)

function appKey() { return process.env.TIKTOK_APP_KEY || '' }
function appSecret() { return process.env.TIKTOK_APP_SECRET || '' }

export function tiktokConfigurato(): boolean {
  return !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_SERVICE_ID)
}

// URL a cui mandare il seller per autorizzare l'app (service_id dell'app approvata).
export function tiktokAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    service_id: process.env.TIKTOK_SERVICE_ID || '',
    state,
  })
  return `${AUTHORIZE_BASE}/open/authorize?${params.toString()}`
}

// Scambia auth_code con access_token + refresh_token
export async function tiktokExchangeCode(code: string): Promise<any> {
  const url = `${AUTH_BASE}/api/v2/token/get?app_key=${encodeURIComponent(appKey())}&app_secret=${encodeURIComponent(appSecret())}&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || d.code !== 0 || !d.data?.access_token) throw new Error('TikTok token: ' + JSON.stringify(d).slice(0, 200))
  return d.data // { access_token, refresh_token, access_token_expire_in, refresh_token_expire_in, open_id, seller_name }
}

// Ritorna un access token valido, rinfrescandolo col refresh token se scaduto
export async function getValidTiktokToken(db: any, integr: any): Promise<string> {
  const cred = (integr.credenziali || {}) as any
  const now = Date.now()
  if (cred.access_token && cred.expires_at && cred.expires_at - now > 5 * 60 * 1000) return cred.access_token
  if (!cred.refresh_token) throw new Error('TikTok: refresh token mancante, ricollega il negozio')

  const url = `${AUTH_BASE}/api/v2/token/refresh?app_key=${encodeURIComponent(appKey())}&app_secret=${encodeURIComponent(appSecret())}&refresh_token=${encodeURIComponent(cred.refresh_token)}&grant_type=refresh_token`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || d.code !== 0 || !d.data?.access_token) throw new Error('TikTok refresh: ' + JSON.stringify(d).slice(0, 200))
  const data = d.data
  const newCred = {
    ...cred,
    access_token: data.access_token,
    refresh_token: data.refresh_token || cred.refresh_token,
    expires_at: now + (Number(data.access_token_expire_in) || 7200) * 1000,
  }
  await db.from('integrazioni').update({ credenziali: newCred }).eq('id', integr.id)
  return data.access_token
}

// Firma HMAC-SHA256 richiesta TikTok:
// input = path + (per ogni param ordinato, escluso sign/access_token) key+value ; se JSON, + body
// firma = HMAC_SHA256( app_secret, app_secret + input + app_secret )  (hex)
function firmaTiktok(path: string, query: Record<string, string>, bodyStr: string): string {
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort()
  let input = path
  for (const k of keys) input += k + query[k]
  if (bodyStr) input += bodyStr
  const base = appSecret() + input + appSecret()
  return crypto.createHmac('sha256', appSecret()).update(base).digest('hex')
}

// Esegue una richiesta firmata verso open-api.tiktokglobalshop.com
export async function tiktokRequest(
  method: 'GET' | 'POST',
  path: string,
  opts: { token: string; shopCipher?: string; query?: Record<string, any>; body?: any } = { token: '' }
): Promise<any> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const query: Record<string, string> = { app_key: appKey(), timestamp }
  if (opts.shopCipher) query.shop_cipher = opts.shopCipher
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== null) query[k] = String(v)

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : ''
  query.sign = firmaTiktok(path, query, bodyStr)

  const qs = new URLSearchParams(query).toString()
  const res = await fetch(`${TIKTOK_API}${path}?${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-tts-access-token': opts.token,
    },
    body: method === 'POST' ? (bodyStr || '{}') : undefined,
  })
  const text = await res.text()
  let d: any = null
  try { d = JSON.parse(text) } catch { d = { raw: text } }
  if (!res.ok || (d && d.code !== undefined && d.code !== 0)) {
    throw new Error(`TikTok ${res.status}: ${(d?.message || text || '').toString().slice(0, 200)}`)
  }
  return d
}

// Recupera i negozi autorizzati (serve shop_cipher + shop_id per tutte le chiamate business)
export async function tiktokGetShops(token: string): Promise<any[]> {
  const d = await tiktokRequest('GET', '/authorization/202309/shops', { token })
  return d?.data?.shops || []
}
