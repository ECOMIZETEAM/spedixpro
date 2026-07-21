import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { ebayAuthorizeUrl } from '@/lib/ebay'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Avvia l'OAuth eBay (il cliente dev'essere loggato per collegare l'account al suo negozio).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/cliente', req.url))
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.redirect(new URL('/cliente', req.url))
  }
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_RU_NAME) {
    return NextResponse.redirect(new URL('/cliente/integrazioni?error=eBay+non+configurato', req.url))
  }

  const state = crypto.randomBytes(24).toString('hex')
  // shopify_oauth_state è chiusa (RLS + no grant): scrivo lo state col client admin (service_role).
  await createAdminSupabase().from('shopify_oauth_state').insert({ state, cliente_id: utente.cliente_id, master_id: utente.master_id, shop: 'ebay' })
  return NextResponse.redirect(ebayAuthorizeUrl(state))
}
