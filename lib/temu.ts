// Helper Temu Open Platform (partner.temu.com — base tecnica PDD/Kuajing).
// OAuth 2.0 + richieste firmate MD5 (stile open platform PDD): gateway unico POST con parametro `type`.
// NB: l'accesso all'Open API Temu è su invito/approvazione. Alcuni nomi API/URL regionali
// ("type", gateway) vanno confermati sui doc partner del venditore una volta approvata l'app.
import crypto from 'crypto'

const GATEWAY = process.env.TEMU_API_BASE || 'https://openapi.kuajingmaihuo.com/openapi/router'
const AUTHORIZE = process.env.TEMU_AUTHORIZE_URL || 'https://partner.temu.com/settings/authorize'
const TOKEN_URL = process.env.TEMU_TOKEN_URL || 'https://openapi.kuajingmaihuo.com/openapi/router'

function appKey() { return process.env.TEMU_APP_KEY || '' }
function appSecret() { return process.env.TEMU_APP_SECRET || '' }

export function temuConfigurato(): boolean {
  return !!(process.env.TEMU_APP_KEY && process.env.TEMU_APP_SECRET)
}

// Firma MD5 stile open platform: MD5( app_secret + Σ(key+value ordinati) + app_secret ).toUpperCase()
export function firmaTemu(params: Record<string, any>): string {
  const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null).sort()
  let s = appSecret()
  for (const k of keys) s += k + (typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k])
  s += appSecret()
  return crypto.createHash('md5').update(s).digest('hex').toUpperCase()
}

// URL di autorizzazione seller
export function temuAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    app_key: appKey(),
    response_type: 'code',
    redirect_uri: process.env.TEMU_REDIRECT || '',
    state,
  })
  return `${AUTHORIZE}?${params.toString()}`
}

// Richiesta firmata al gateway (type = nome API). Usata anche per il token.
export async function temuRequest(type: string, params: Record<string, any> = {}, accessToken?: string): Promise<any> {
  const base: Record<string, any> = {
    type,
    app_key: appKey(),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    data_type: 'JSON',
    ...params,
  }
  if (accessToken) base.access_token = accessToken
  base.sign = firmaTemu(base)

  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]))),
  })
  const text = await res.text()
  let d: any = null
  try { d = JSON.parse(text) } catch { d = { raw: text } }
  if (!res.ok || d?.error_response || d?.errorCode) {
    const msg = d?.error_response?.error_msg || d?.errorMsg || text
    throw new Error(`Temu ${res.status}: ${String(msg).slice(0, 200)}`)
  }
  return d
}

// Scambia il code coi token (bg.open.accesstoken.create — DA CONFERMARE sui doc partner)
export async function temuExchangeCode(code: string): Promise<any> {
  const p: Record<string, any> = {
    type: 'bg.open.accesstoken.create',
    app_key: appKey(),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.TEMU_REDIRECT || '',
  }
  p.sign = firmaTemu(p)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(p as Record<string, string>),
  })
  const d = await res.json().catch(() => ({}))
  const data = d?.access_token ? d : (d?.result || d?.data || {})
  if (!data.access_token) throw new Error('Temu token: ' + JSON.stringify(d).slice(0, 200))
  return data // { access_token, refresh_token, expires_in }
}

// Access token valido (refresh se scaduto)
export async function getValidTemuToken(db: any, integr: any): Promise<string> {
  const cred = (integr.credenziali || {}) as any
  const now = Date.now()
  if (cred.access_token && cred.expires_at && cred.expires_at - now > 5 * 60 * 1000) return cred.access_token
  if (!cred.refresh_token) throw new Error('Temu: refresh token mancante, ricollega il negozio')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams((() => {
      const p: any = { type: 'bg.open.accesstoken.refresh', app_key: appKey(), timestamp: Math.floor(now / 1000).toString(), refresh_token: cred.refresh_token, grant_type: 'refresh_token' }
      p.sign = firmaTemu(p)
      return p
    })()),
  })
  const d = await res.json().catch(() => ({}))
  const data = d?.access_token ? d : (d?.result || d?.data || {})
  if (!data.access_token) throw new Error('Temu refresh: ' + JSON.stringify(d).slice(0, 200))
  const newCred = { ...cred, access_token: data.access_token, refresh_token: data.refresh_token || cred.refresh_token, expires_at: now + (Number(data.expires_in) || 7200) * 1000 }
  await db.from('integrazioni').update({ credenziali: newCred }).eq('id', integr.id)
  return data.access_token
}
