import { createServerSupabase } from '@/lib/supabase'

const API_VERSION = '2026-04'

// Restituisce un access token Shopify valido per l'integrazione data.
// Se il token e' scaduto (o sta per scadere), lo rifresca col refresh token
// e aggiorna le credenziali salvate. Ritorna { token } oppure { error }.
export async function getValidShopifyToken(integrazione: any): Promise<{ token?: string; error?: string }> {
  const cred = (integrazione?.credenziali || {}) as any
  const shop = cred.shop
  const token = cred.access_token
  const refreshToken = cred.refresh_token
  const expiresAt = cred.expires_at ? Number(cred.expires_at) : null

  if (!shop || !token) return { error: 'Credenziali Shopify mancanti' }

  // Token ancora valido (con margine di 5 minuti)? Usalo.
  const now = Date.now()
  if (!expiresAt || expiresAt - now > 5 * 60 * 1000) {
    return { token }
  }

  // Scaduto o in scadenza: rifresca col refresh token
  if (!refreshToken) {
    return { error: 'Token scaduto e nessun refresh token disponibile. Ricollega il negozio.' }
  }
  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        expiring: '1',
      }),
    })
    const d = await r.json()
    if (!d.access_token) return { error: 'Refresh token fallito: ' + JSON.stringify(d).slice(0, 200) }

    const n = Date.now()
    const newCred = {
      ...cred,
      access_token: d.access_token,
      refresh_token: d.refresh_token || refreshToken,
      expires_at: d.expires_in ? n + Number(d.expires_in) * 1000 : null,
      refresh_expires_at: d.refresh_token_expires_in ? n + Number(d.refresh_token_expires_in) * 1000 : cred.refresh_expires_at,
    }
    const supabase = await createServerSupabase()
    await supabase.from('integrazioni').update({ credenziali: newCred }).eq('id', integrazione.id)
    return { token: d.access_token }
  } catch (e: any) {
    return { error: 'Errore refresh token: ' + (e?.message || e) }
  }
}

export { API_VERSION }
