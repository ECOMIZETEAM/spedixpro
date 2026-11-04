import { NextRequest, NextResponse } from 'next/server'
import { conErrore, conCollegato, type CodiceErrore } from '@/lib/esiti-collegamento'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { credenzialiDaTokenTiktok, tiktokExchangeCode, tiktokGetShops } from '@/lib/tiktok'
import {
  PAGINA_COLLEGA_TIKTOK, collegaNegozioTiktok, conCookieSospesoTiktok, negoziDaShops, rinnovaNegoziGiaCollegati,
  sigillaSospesoTiktok, type NegozioTiktok,
} from '@/lib/tiktokCollega'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback OAuth TikTok Shop: scambia il code coi token, recupera i negozi autorizzati e li collega.
//
// Ci arrivano due giri diversi (lib/tiktokCollega.ts):
// - dal portale: lo state l'ha scritto /install col cliente che ha cliccato, e il negozio va a lui;
// - dall'App Store del Seller Center: TikTok manda il SOLO codice. I negozi che hanno gia' un conto si
//   rinnovano; gli altri aspettano nel cookie cifrato che il venditore confermi il suo conto MoovExpress.
// Il codice si scambia subito in tutti e due i casi: e' di breve durata, e un codice scaduto mentre il
// venditore cerca la password lo costringerebbe a rifare l'installazione da TikTok.
// Le scritture passano dal client di servizio: al ritorno dall'OAuth il cookie di sessione puo' mancare.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || url.searchParams.get('auth_code') || ''
  const state = url.searchParams.get('state') || ''
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin
  const errore = (codice: CodiceErrore) => NextResponse.redirect(`${appUrl}${conErrore('/cliente/integrazioni', codice)}`)

  if (!code) return errore('tiktok_annullato')

  const admin = createAdminSupabase()
  let clienteDelloState: string | null = null
  if (state) {
    // shopify_oauth_state è chiusa (RLS + no grant): si legge e si cancella col client di servizio.
    const { data: st } = await admin.from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
    if (!st || st.shop !== 'tiktok' || !st.cliente_id) return errore('tiktok_scaduto')
    await admin.from('shopify_oauth_state').delete().eq('state', state)
    clienteDelloState = String(st.cliente_id)
  }

  let tokens: any
  try {
    tokens = await tiktokExchangeCode(code)
  } catch (e: any) {
    // Il motivo tecnico va nel log, non nell'indirizzo: al cliente non serve, e nell'URL finiva in
    // chiaro qualunque testo restituito da TikTok.
    console.error('[TIKTOK][CALLBACK] scambio token', e?.message || e)
    return errore('tiktok_token')
  }
  const credenziali = credenzialiDaTokenTiktok(tokens)

  // Tutti i negozi autorizzati, non il primo: chi ne autorizza due insieme perdeva il secondo.
  let negozi: NegozioTiktok[] = []
  try {
    negozi = negoziDaShops(await tiktokGetShops(tokens.access_token))
  } catch (e: any) {
    console.error('[TIKTOK][CALLBACK] recupero negozio', e?.message || e)
    return errore('tiktok_negozio')
  }
  if (!negozi.length) {
    console.error('[TIKTOK][CALLBACK] nessun negozio autorizzato con id e cipher')
    return errore('tiktok_negozio')
  }

  if (clienteDelloState) {
    const esiti = await Promise.all(negozi.map(negozio => collegaNegozioTiktok(admin, { clienteId: clienteDelloState!, negozio, credenziali })))
    // «Collegato» solo se almeno un negozio e' davvero di questo cliente: il portale lo mostra come fatto.
    if (esiti.some(e => e.ok)) return NextResponse.redirect(`${appUrl}${conCollegato('/cliente/integrazioni', 'tiktok')}`)
    return errore(esiti.some(e => !e.ok && e.codice === 'tiktok_non_salvato') ? 'tiktok_non_salvato' : 'tiktok_altro_account')
  }

  const daChiedere = await rinnovaNegoziGiaCollegati(admin, negozi, credenziali)
  if (!daChiedere.length) return NextResponse.redirect(`${appUrl}${conCollegato('/cliente/integrazioni', 'tiktok')}`)
  const sigillo = sigillaSospesoTiktok(credenziali, daChiedere)
  if (!sigillo) {
    console.error('[TIKTOK][CALLBACK] TIKTOK_APP_SECRET assente: installazione dall\'App Store non conservabile')
    return errore('tiktok_non_configurato')
  }
  // Stesso host della richiesta: il cookie vale per il dominio da cui risponde questa rotta.
  return conCookieSospesoTiktok(NextResponse.redirect(new URL(PAGINA_COLLEGA_TIKTOK, req.url)), sigillo)
}
