import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { ebayExchangeCode } from '@/lib/ebay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback OAuth eBay: scambia il code coi token e salva l'integrazione del cliente.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!code || !state) return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=callback+eBay+non+valido`)

  const supabase = await createServerSupabase()
  const { data: st } = await supabase.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== 'ebay') {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=state+non+valido`)
  }
  await supabase.from('shopify_oauth_state').delete().eq('state', state)

  let tokens: any
  try {
    tokens = await ebayExchangeCode(code)
  } catch (e: any) {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('eBay: ' + (e?.message || 'scambio token fallito'))}`)
  }

  const now = Date.now()
  const cred = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: now + (Number(tokens.expires_in) || 7200) * 1000,
    refresh_expires_at: tokens.refresh_token_expires_in ? now + Number(tokens.refresh_token_expires_in) * 1000 : null,
  }
  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'ebay',
    nome_negozio: 'eBay', identificativo: 'ebay',
    credenziali: cred, stato: 'attivo', errore: null,
  }
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'ebay').eq('identificativo', 'ebay').maybeSingle()
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)

  return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=ebay`)
}
