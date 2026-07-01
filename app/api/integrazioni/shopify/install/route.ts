import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Scope allineati a quelli impostati sulla app Shopify (Partner Dashboard)
const SCOPES = 'read_orders,read_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders'
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/cliente', req.url))

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { data: cliente } = await supabase
    .from('clienti').select('master_id').eq('id', utente.cliente_id).single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  const shop = (new URL(req.url).searchParams.get('shop') || '').trim().toLowerCase()
  if (!SHOP_RE.test(shop)) {
    return NextResponse.json({ error: 'Dominio Shopify non valido' }, { status: 400 })
  }

  const apiKey = process.env.SHOPIFY_API_KEY
  const appUrl = process.env.SHOPIFY_APP_URL
  if (!apiKey || !appUrl) {
    return NextResponse.json({ error: 'Configurazione Shopify mancante (variabili ambiente)' }, { status: 500 })
  }

  // state anti-CSRF, collegato al cliente
  const state = crypto.randomBytes(24).toString('hex')
  const { error } = await supabase.from('shopify_oauth_state').insert({
    state, cliente_id: utente.cliente_id, master_id: cliente.master_id, shop,
  })
  if (error) {
    return NextResponse.json({ error: 'Errore avvio OAuth: ' + error.message }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/integrazioni/shopify/callback`
  const authorize =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(apiKey)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`

  return NextResponse.redirect(authorize)
}
