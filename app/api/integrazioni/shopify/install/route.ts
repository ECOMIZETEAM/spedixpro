import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Scope allineati a quelli impostati sulla app Shopify (Partner Dashboard)
const SCOPES = 'read_orders,read_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders,write_assigned_fulfillment_orders,write_merchant_managed_fulfillment_orders,write_third_party_fulfillment_orders'
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export async function GET(req: NextRequest) {
  const shop = (new URL(req.url).searchParams.get('shop') || '').trim().toLowerCase()
  if (!SHOP_RE.test(shop)) {
    return NextResponse.json({ error: 'Dominio Shopify non valido' }, { status: 400 })
  }

  const apiKey = process.env.SHOPIFY_API_KEY
  if (!apiKey) {
    // Config mancante: non un 500 nudo (il reviewer vedrebbe "la pagina non funziona"), ma una
    // pagina utile con il perché.
    return NextResponse.redirect(new URL('/cliente/integrazioni?shopify_error=config', req.url))
  }
  // App URL NORMALIZZATA: niente slash finale + fallback all'origine. Shopify confronta il redirect_uri
  // BYTE-A-BYTE con l'allowed redirection URL: uno slash di troppo (//api), http, o www invece
  // dell'apex fa fallire l'authorize con "redirect_uri is not whitelisted" -> pagina d'errore Shopify.
  const appUrl = (process.env.SHOPIFY_APP_URL || new URL(req.url).origin).trim().replace(/\/+$/, '')

  // L'OAuth parte SUBITO (requisito app pubblica Shopify).
  // Se un cliente MoovExpress e' gia' loggato, colleghiamo il negozio al volo:
  // salviamo cliente_id/master_id nello state. Altrimenti restano null e il
  // collegamento avverra' dopo il login (negozio in stato pending).
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  let clienteId: string | null = null
  let masterId: string | null = null
  if (user) {
    const { data: utente } = await supabase
      .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
    if (utente?.ruolo === 'cliente' && utente?.cliente_id) {
      clienteId = utente.cliente_id
      const { data: cliente } = await supabase
        .from('clienti').select('master_id').eq('id', utente.cliente_id).single()
      masterId = cliente?.master_id || null
    }
  }

  // state anti-CSRF (cliente_id/master_id opzionali). La tabella shopify_oauth_state è chiusa
  // (RLS + no grant anon/authenticated): vi si scrive/legge col client admin (service_role).
  const state = crypto.randomBytes(24).toString('hex')
  const { error } = await createAdminSupabase().from('shopify_oauth_state').insert({
    state, cliente_id: clienteId, master_id: masterId, shop,
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
