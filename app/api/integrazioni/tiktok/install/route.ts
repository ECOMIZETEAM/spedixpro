import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { tiktokAuthorizeUrl, tiktokConfigurato } from '@/lib/tiktok'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Avvia l'OAuth TikTok Shop (il cliente dev'essere loggato per collegare il negozio al suo account).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/cliente', req.url))
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.redirect(new URL('/cliente', req.url))
  }
  if (!tiktokConfigurato()) {
    return NextResponse.redirect(new URL('/cliente/integrazioni?error=TikTok+Shop+non+configurato', req.url))
  }

  const state = crypto.randomBytes(24).toString('hex')
  await supabase.from('shopify_oauth_state').insert({ state, cliente_id: utente.cliente_id, master_id: utente.master_id, shop: 'tiktok' })
  return NextResponse.redirect(tiktokAuthorizeUrl(state))
}
