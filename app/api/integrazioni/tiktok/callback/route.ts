import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { tiktokExchangeCode, tiktokGetShops } from '@/lib/tiktok'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback OAuth TikTok Shop: scambia il code coi token, recupera il negozio e salva l'integrazione.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || url.searchParams.get('auth_code') || ''
  const state = url.searchParams.get('state') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!code || !state) return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=callback+TikTok+non+valido`)

  const supabase = await createServerSupabase()
  const { data: st } = await supabase.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== 'tiktok') {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=state+non+valido`)
  }
  await supabase.from('shopify_oauth_state').delete().eq('state', state)

  let tokens: any
  try {
    tokens = await tiktokExchangeCode(code)
  } catch (e: any) {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('TikTok: ' + (e?.message || 'scambio token fallito'))}`)
  }

  const now = Date.now()
  const cred: any = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: now + (Number(tokens.access_token_expire_in) || 7200) * 1000,
    refresh_expires_at: tokens.refresh_token_expire_in ? now + Number(tokens.refresh_token_expire_in) * 1000 : null,
    open_id: tokens.open_id || null,
    seller_name: tokens.seller_name || null,
  }

  // Recupero il negozio autorizzato (shop_cipher + shop_id servono per tutte le chiamate business)
  let nomeNegozio = tokens.seller_name || 'TikTok Shop'
  try {
    const shops = await tiktokGetShops(tokens.access_token)
    if (shops.length) {
      cred.shop_cipher = shops[0].cipher
      cred.shop_id = shops[0].id
      cred.shop_region = shops[0].region
      nomeNegozio = shops[0].name || nomeNegozio
    }
  } catch (e: any) {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('TikTok: ' + (e?.message || 'recupero negozio fallito'))}`)
  }

  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'tiktok',
    nome_negozio: nomeNegozio, identificativo: cred.shop_id || 'tiktok',
    credenziali: cred, stato: 'attivo', errore: null,
  }
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'tiktok').maybeSingle()
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)

  return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=tiktok`)
}
