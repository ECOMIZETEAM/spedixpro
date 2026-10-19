import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonScambiaCodice, amazonNomeNegozio, credenzialiAmazon } from '@/lib/amazon'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ritorno da Seller Central dopo che il venditore ha autorizzato l'app: scambia il codice con i
// token e salva l'integrazione del cliente, coi token CIFRATI (lib/cifratura-integrazioni).
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') || ''
  const codice = url.searchParams.get('spapi_oauth_code') || ''
  const sellerId = url.searchParams.get('selling_partner_id') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin
  // Referrer-Policy no-referrer: Amazon lo chiede sull'indirizzo di ritorno, perche' l'URL porta il
  // codice di autorizzazione e non deve finire nell'intestazione Referer della pagina dopo.
  const torna = (q: string) => {
    const r = NextResponse.redirect(`${appUrl}/cliente/integrazioni?${q}`)
    r.headers.set('Referrer-Policy', 'no-referrer')
    return r
  }

  if (!state || !codice || !sellerId) return torna('error=callback+Amazon+non+valido')

  // Client di servizio, come per eBay: al ritorno da Amazon il cookie di sessione puo' mancare
  // (redirect fra siti diversi). Lo `state` e' il segreto e porta cliente e master.
  const supabase = createAdminSupabase()
  const { data: st } = await supabase.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== 'amazon') return torna('error=state+non+valido')
  await supabase.from('shopify_oauth_state').delete().eq('state', state)
  // Uno state vecchio non vale: il codice di Amazon scade in pochi minuti, e uno state rimasto in
  // tabella per ore e' un giro abbandonato che nessuno deve poter riprendere.
  if (Date.now() - new Date(st.created_at).getTime() > 30 * 60 * 1000) return torna('error=autorizzazione+Amazon+scaduta,+riprova')

  let tokens: { access_token: string; refresh_token: string; expires_in: number }
  try {
    tokens = await amazonScambiaCodice(codice)
  } catch (e: any) {
    return torna('error=' + encodeURIComponent('Amazon: ' + (e?.message || 'scambio token fallito')))
  }

  // Un cliente puo' collegare piu' account venditore: ognuno e' una riga, riconosciuta dal suo
  // selling_partner_id (come eBay con lo username).
  const identificativo = `amazon:${sellerId}`
  const nome = await amazonNomeNegozio(tokens.access_token)
  const payload: any = {
    master_id: st.master_id, cliente_id: st.cliente_id, piattaforma: 'amazon',
    nome_negozio: nome ? `Amazon: ${nome}` : 'Amazon',
    identificativo,
    credenziali: credenzialiAmazon({ sellerId, refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresIn: tokens.expires_in }),
    stato: 'attivo', errore: null,
  }
  const { data: esistente } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', st.cliente_id).eq('piattaforma', 'amazon').eq('identificativo', identificativo).maybeSingle()
  const { error } = esistente?.id
    ? await supabase.from('integrazioni').update(payload).eq('id', esistente.id)
    : await supabase.from('integrazioni').insert(payload)
  if (error) return torna('error=' + encodeURIComponent('Amazon: salvataggio non riuscito'))

  return torna('connected=amazon')
}
