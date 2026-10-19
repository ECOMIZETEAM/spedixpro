import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonAuthorizeUrl, amazonConfigurato } from '@/lib/amazon'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Avvia l'autorizzazione Amazon (Seller Central): il cliente dev'essere loggato, perche' l'account
// Amazon si collega al SUO negozio. Stesso schema di eBay: lo `state` e' il segreto del giro e porta
// con se' cliente e master.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/cliente', req.url))
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.redirect(new URL('/cliente', req.url))
  }
  // Senza le chiavi dell'app Amazon (e senza la chiave che cifra i token) il collegamento non parte:
  // un token Amazon non deve mai finire nel database in chiaro.
  if (!amazonConfigurato()) {
    return NextResponse.redirect(new URL('/cliente/integrazioni?error=Amazon+non+configurato', req.url))
  }

  const state = crypto.randomBytes(24).toString('hex')
  // shopify_oauth_state e' chiusa (RLS + niente grant): lo state lo scrive il client di servizio.
  await createAdminSupabase().from('shopify_oauth_state').insert({ state, cliente_id: utente.cliente_id, master_id: utente.master_id, shop: 'amazon' })
  return NextResponse.redirect(amazonAuthorizeUrl(state))
}
