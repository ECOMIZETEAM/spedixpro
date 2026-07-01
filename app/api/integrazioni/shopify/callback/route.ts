import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
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

  // Valida e consuma lo state
  const { data: st } = await supabase
    .from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== shop) {
    return NextResponse.json({ error: 'State non valido o scaduto — riprova il collegamento' }, { status: 400 })
  }
  await supabase.from('shopify_oauth_state').delete().eq('state', state)

  // Scambia code -> access token
  let token = ''
  let scope = ''
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
    })
    const d = await r.json()
    token = d.access_token
    scope = d.scope || ''
    if (!token) throw new Error('nessun access_token ricevuto')
  } catch (e: any) {
    return NextResponse.json({ error: 'Scambio token fallito: ' + (e?.message || e) }, { status: 502 })
  }

  // Salva / aggiorna l'integrazione (credenziali in chiaro, coerente con corrieri)
  const payload: any = {
    master_id: st.master_id,
    cliente_id: st.cliente_id,
    piattaforma: 'shopify',
    nome_negozio: shop,
    identificativo: shop,
    credenziali: { access_token: token, scope, shop },
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
