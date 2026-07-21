import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { temuExchangeCode } from '@/lib/temu'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback OAuth Temu: scambia il code coi token e salva l'integrazione del cliente.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!code || !state) return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=callback+Temu+non+valido`)

  const supabase = await createServerSupabase()
  // shopify_oauth_state è chiusa (RLS + no grant) e il cookie può mancare al ritorno OAuth: uso admin.
  const adminState = createAdminSupabase()
  const { data: st } = await adminState.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== 'temu') {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=state+non+valido`)
  }
  await adminState.from('shopify_oauth_state').delete().eq('state', state)

  let tokens: any
  try {
    tokens = await temuExchangeCode(code)
  } catch (e: any) {
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('Temu: ' + (e?.message || 'scambio token fallito'))}`)
  }

  const now = Date.now()
  const cred: any = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_at: now + (Number(tokens.expires_in) || 7200) * 1000,
    mall_id: tokens.mall_id || tokens.shop_id || null,
    seller_name: tokens.seller_name || tokens.mall_name || null,
  }
  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'temu',
    nome_negozio: cred.seller_name || 'Temu', identificativo: cred.mall_id || 'temu',
    credenziali: cred, stato: 'attivo', errore: null,
  }
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'temu').maybeSingle()
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)

  return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=temu`)
}
