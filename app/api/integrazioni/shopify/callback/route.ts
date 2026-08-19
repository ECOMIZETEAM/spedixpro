import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { provisionShopifyCliente } from '@/lib/shopifyProvision'
import { loginMerchantERedirect } from '@/lib/shopifyLogin'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

// Verifica firma HMAC della richiesta Shopify (valori decodificati, key=value ordinati, join &)
function verifyHmac(sp: URLSearchParams, secret: string): boolean {
  const hmac = sp.get('hmac') || ''
  const entries: string[] = []
  sp.forEach((v, k) => { if (k !== 'hmac' && k !== 'signature') entries.push(`${k}=${v}`) })
  entries.sort()
  const message = entries.join('&')
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = url.searchParams
  const shop = (sp.get('shop') || '').toLowerCase()
  const code = sp.get('code') || ''
  const state = sp.get('state') || ''

  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'Configurazione Shopify mancante (variabili ambiente)' }, { status: 500 })
  }
  if (!SHOP_RE.test(shop) || !code || !state) {
    return NextResponse.json({ error: 'Callback Shopify non valido' }, { status: 400 })
  }
  if (!verifyHmac(sp, apiSecret)) {
    return NextResponse.json({ error: 'Verifica HMAC fallita' }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  // shopify_oauth_state è chiusa (RLS + no grant anon/authenticated) e al ritorno cross-site dall'OAuth
  // il cookie di sessione può mancare: leggo/consumo lo state col client admin (service_role).
  const adminState = createAdminSupabase()

  // Valida e consuma lo state
  const { data: st } = await adminState
    .from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== shop) {
    // State gia' consumato (reload/back/retry del callback) o scaduto. IDEMPOTENZA: se il negozio
    // RISULTA GIA' COLLEGATO, il primo giro e' andato a buon fine -> trattiamo il reload come successo,
    // invece del vecchio JSON "400 State non valido" che sembra "l'app non funziona". Altrimenti si
    // manda a una pagina utile per riprovare, non a un errore grezzo.
    const { data: gia } = await adminState.from('integrazioni').select('id')
      .eq('piattaforma', 'shopify').eq('identificativo', shop).eq('stato', 'attivo').maybeSingle()
    if (gia?.id) return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=${encodeURIComponent(shop)}`)
    return NextResponse.redirect(new URL('/cliente?error=collegamento_scaduto', req.url))
  }
  await adminState.from('shopify_oauth_state').delete().eq('state', state)

  // Scambia code -> access token OFFLINE A SCADENZA (`expiring=1`). Shopify NON accetta piu' i
  // token offline non-scadenti sull'Admin API (risponde 403 "Non-expiring access tokens are no
  // longer accepted"). Con `expiring=1` la risposta porta access_token + expires_in + refresh_token:
  // il token si rinnova col refresh (vedi getValidShopifyToken), non si "rompe". Al refresh Shopify
  // INVALIDA il vecchio refresh_token, quindi va sempre salvato quello nuovo.
  let token = ''
  let scope = ''
  let refreshToken = ''
  let expiresAt: number | null = null
  let refreshExpiresAt: number | null = null
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code, expiring: '1' }),
    })
    const raw = await r.text()
    let d: any = null
    try { d = JSON.parse(raw) } catch {}
    if (!r.ok || !d) throw new Error(`HTTP ${r.status} — risposta non valida da Shopify`)
    token = d.access_token
    scope = d.scope || ''
    refreshToken = d.refresh_token || ''
    const now = Date.now()
    if (d.expires_in) expiresAt = now + Number(d.expires_in) * 1000
    if (d.refresh_token_expires_in) refreshExpiresAt = now + Number(d.refresh_token_expires_in) * 1000
    if (!token) throw new Error('nessun access_token ricevuto')
  } catch (e: any) {
    console.error('[SHOPIFY][CALLBACK] scambio token', shop, e?.message || e)
    // Non un 502 JSON grezzo (sembra "l'app non funziona"): pagina utile per riprovare.
    return NextResponse.redirect(new URL('/cliente?error=collegamento_token', req.url))
  }

  // CASO A: cliente gia' identificato -> integrazione attiva
  if (st.cliente_id) {
  const payload: any = {
    master_id: st.master_id,
    cliente_id: st.cliente_id,
    piattaforma: 'shopify',
    nome_negozio: shop,
    identificativo: shop,
    credenziali: { access_token: token, scope, shop, refresh_token: refreshToken, expires_at: expiresAt, refresh_expires_at: refreshExpiresAt },
    stato: 'attivo',
    errore: null,
  }

  const { data: existing } = await supabase
    .from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id)
    .eq('piattaforma', 'shopify')
    .eq('identificativo', shop)
    .maybeSingle()

  if (existing?.id) {
    await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('integrazioni').insert(payload)
  }

  return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=${encodeURIComponent(shop)}`)
  }

  // CASO B: install dallo store senza cliente identificato -> AUTO-CREAZIONE.
  // Creo (o riuso) un cliente MoovExpress sotto il master di onboarding (default root),
  // collego il negozio e porto il merchant nel portale GIÀ LOGGATO (modello redirect).
  const admin = createAdminSupabase()
  const prov = await provisionShopifyCliente(admin, shop, token)
  if ('error' in prov) {
    return NextResponse.redirect(`${appUrl}/cliente?error=${encodeURIComponent(prov.error)}`)
  }
  const payload: any = {
    master_id: prov.masterId, cliente_id: prov.clienteId, piattaforma: 'shopify',
    nome_negozio: shop, identificativo: shop,
    credenziali: { access_token: token, scope, shop, refresh_token: refreshToken, expires_at: expiresAt, refresh_expires_at: refreshExpiresAt },
    stato: 'attivo', errore: null,
  }
  const { data: existing } = await admin.from('integrazioni').select('id')
    .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  if (existing?.id) await admin.from('integrazioni').update(payload).eq('id', existing.id)
  else await admin.from('integrazioni').insert(payload)

  // login automatico nel portale MoovExpress
  return loginMerchantERedirect(req, prov.email, '/cliente/dashboard')
}
