import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { ebayExchangeCode, getEbayUser } from '@/lib/ebay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback OAuth eBay: scambia il code coi token e salva l'integrazione del cliente.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!code || !state) return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=callback+eBay+non+valido`)

  // ADMIN (service role): il callback OAuth NON dipende dalla sessione utente. Al ritorno da eBay il
  // cookie di sessione può mancare (redirect cross-site) e con l'anon chiuso la lettura dello stato
  // falliva → "state non valido", nessuna integrazione, connessione bloccata per alcuni clienti.
  // Lo `state` è già il segreto e contiene cliente_id/master_id: leggiamo/scriviamo via admin.
  const supabase = createAdminSupabase()
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

  // Username del venditore (se lo scope identity è attivo) → così un cliente può collegare PIÙ
  // account eBay: ognuno è una riga distinta (identificativo = username). Senza username restiamo
  // sull'identificativo 'ebay' (un solo eBay per cliente, comportamento storico).
  const info = await getEbayUser(tokens.access_token)
  const username = info?.username || null
  const identificativo = username ? `ebay:${username.toLowerCase()}` : 'ebay'
  const nomeNegozio = username ? `eBay: ${username}` : 'eBay'

  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'ebay',
    nome_negozio: nomeNegozio, identificativo,
    credenziali: cred, stato: 'attivo', errore: null,
  }
  // Aggiorna la connessione dello STESSO account (stesso identificativo); altrimenti ne crea una nuova.
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'ebay').eq('identificativo', identificativo).maybeSingle()
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)

  return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=ebay`)
}
