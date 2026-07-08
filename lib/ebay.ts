// Helper eBay Sell API (OAuth 2.0 user token con refresh).
const EBAY_OAUTH = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_API = 'https://api.ebay.com'
export const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment'

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')
}

// URL a cui mandare il merchant per autorizzare (redirect_uri = RuName configurato su eBay Developer)
export function ebayAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: process.env.EBAY_RU_NAME || '',
    scope: EBAY_SCOPES,
    state,
  })
  return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`
}

// Scambia il code con access_token + refresh_token
export async function ebayExchangeCode(code: string): Promise<any> {
  const res = await fetch(EBAY_OAUTH, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.EBAY_RU_NAME || '' }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token) throw new Error('eBay token: ' + JSON.stringify(d).slice(0, 200))
  return d // { access_token, refresh_token, expires_in, refresh_token_expires_in }
}

// Ritorna un access token valido, rinfrescandolo col refresh token se scaduto
export async function getValidEbayToken(db: any, integr: any): Promise<string> {
  const cred = (integr.credenziali || {}) as any
  const now = Date.now()
  if (cred.access_token && cred.expires_at && cred.expires_at - now > 5 * 60 * 1000) return cred.access_token
  if (!cred.refresh_token) throw new Error('eBay: refresh token mancante, ricollega il negozio')

  const res = await fetch(EBAY_OAUTH, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cred.refresh_token, scope: EBAY_SCOPES }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token) throw new Error('eBay refresh: ' + JSON.stringify(d).slice(0, 200))
  const newCred = { ...cred, access_token: d.access_token, expires_at: now + (Number(d.expires_in) || 7200) * 1000 }
  await db.from('integrazioni').update({ credenziali: newCred }).eq('id', integr.id)
  return d.access_token
}

export async function ebayGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${EBAY_API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`eBay ${res.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return null }
}

export async function ebayPost(token: string, path: string, body: any): Promise<any> {
  const res = await fetch(`${EBAY_API}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`eBay ${res.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return {} }
}
