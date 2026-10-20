import { NextRequest, NextResponse } from 'next/server'
import { conErrore, conCollegato } from '@/lib/esiti-collegamento'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { tiktokExchangeCode, tiktokGetShops } from '@/lib/tiktok'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback OAuth TikTok Shop: scambia il code coi token, recupera il negozio e salva l'integrazione.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || url.searchParams.get('auth_code') || ''
  const state = url.searchParams.get('state') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!code || !state) return NextResponse.redirect(`${appUrl}${conErrore('/cliente/integrazioni', 'tiktok_annullato')}`)

  const supabase = await createServerSupabase()
  // shopify_oauth_state è chiusa (RLS + no grant) e il cookie può mancare al ritorno OAuth: uso admin.
  const adminState = createAdminSupabase()
  const { data: st } = await adminState.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== 'tiktok') {
    return NextResponse.redirect(`${appUrl}${conErrore('/cliente/integrazioni', 'tiktok_scaduto')}`)
  }
  await adminState.from('shopify_oauth_state').delete().eq('state', state)

  let tokens: any
  try {
    tokens = await tiktokExchangeCode(code)
  } catch (e: any) {
    // Il motivo tecnico va nel log, non nell'indirizzo: al cliente non serve, e nell'URL finiva in
    // chiaro qualunque testo restituito da TikTok.
    console.error('[TIKTOK][CALLBACK] scambio token', e?.message || e)
    return NextResponse.redirect(`${appUrl}${conErrore('/cliente/integrazioni', 'tiktok_token')}`)
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
    console.error('[TIKTOK][CALLBACK] recupero negozio', e?.message || e)
    return NextResponse.redirect(`${appUrl}${conErrore('/cliente/integrazioni', 'tiktok_negozio')}`)
  }

  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'tiktok',
    nome_negozio: nomeNegozio, identificativo: cred.shop_id || 'tiktok',
    credenziali: cred, stato: 'attivo', errore: null,
  }
  // Multi-shop: la lookup deve includere l'identificativo (shop_id), come eBay. Senza, collegare un
  // SECONDO negozio TikTok faceva UPDATE sulla riga del primo, perdendone credenziali/shop_cipher.
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'tiktok').eq('identificativo', cred.shop_id || 'tiktok').maybeSingle()
  // L'esito si guarda: questa scrittura passa dalla sessione, che al ritorno dall'OAuth puo' mancare,
  // e senza il controllo si tornava lo stesso su «?connected=tiktok» — che ora il portale mostra come
  // «collegato» anche per un negozio mai salvato.
  const esito = existing?.id
    ? await supabase.from('integrazioni').update(payload).eq('id', existing.id)
    : await supabase.from('integrazioni').insert(payload)
  if (esito.error) {
    console.error('[TIKTOK][CALLBACK] integrazione non salvata', esito.error.message)
    return NextResponse.redirect(`${appUrl}${conErrore('/cliente/integrazioni', 'tiktok_non_salvato')}`)
  }

  return NextResponse.redirect(`${appUrl}${conCollegato('/cliente/integrazioni', 'tiktok')}`)
}
