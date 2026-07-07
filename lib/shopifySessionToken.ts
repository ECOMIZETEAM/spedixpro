import crypto from 'crypto'

// Verifica il SESSION TOKEN (id token) generato da App Bridge nell'app embedded.
// È un JWT firmato HS256 con lo SHOPIFY_API_SECRET. Verificandolo ricaviamo lo
// "shop" senza bisogno di un login separato — è ciò che rende l'app embedded.
// Ref: https://shopify.dev/docs/apps/auth/session-tokens

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export type SessionTokenClaims = {
  shop: string          // xxx.myshopify.com
  dest: string          // https://xxx.myshopify.com
  sub: string           // id utente Shopify
  aud: string           // api key dell'app
  exp: number
}

// Ritorna i claim se il token è valido, altrimenti null.
export function verifySessionToken(token: string | null | undefined): SessionTokenClaims | null {
  const secret = process.env.SHOPIFY_API_SECRET
  const apiKey = process.env.SHOPIFY_API_KEY
  if (!token || !secret || !apiKey) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  // 1) firma HS256 su "header.payload"
  const expected = crypto.createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`).digest()
  const got = b64urlDecode(sigB64)
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null

  // 2) claim
  let payload: any
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) } catch { return null }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now) return null        // scaduto
  if (typeof payload.nbf === 'number' && payload.nbf > now + 5) return null     // non ancora valido
  if (payload.aud !== apiKey) return null                                       // audience errata

  // dest = "https://xxx.myshopify.com" -> shop
  const dest = String(payload.dest || '')
  const m = dest.match(/^https:\/\/([a-z0-9][a-z0-9-]*\.myshopify\.com)$/)
  if (!m) return null

  return { shop: m[1], dest, sub: String(payload.sub || ''), aud: payload.aud, exp: payload.exp }
}

// Estrae e verifica il token dall'header Authorization: Bearer <token>
export function verifySessionTokenFromHeader(authHeader: string | null): SessionTokenClaims | null {
  if (!authHeader) return null
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return verifySessionToken(m ? m[1] : null)
}
