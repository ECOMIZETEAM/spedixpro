import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonAuthorizeUrl, amazonConfigurato, richiestaDalPortale } from '@/lib/amazon'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Avvia l'autorizzazione Amazon (Seller Central) dalla pagina Integrazioni del cliente loggato.
//
// SOLO DALLE NOSTRE PAGINE (POST con origine nostra). Un link qualunque che porti qui non deve
// poter avviare un collegamento: chi riuscisse a far entrare il browser di un altro nel PROPRIO
// portale (per esempio col link firmato di Shopify, che si puo' riusare) gli farebbe autorizzare un
// account Amazon che poi finirebbe sul portale sbagliato, coi dati dei suoi compratori. Una
// richiesta che parte da un altro sito qui non arriva: la pagina chiama questa rotta con fetch.
export async function POST(req: NextRequest) {
  if (!richiestaDalPortale(req)) return NextResponse.json({ error: 'Richiesta non valida' }, { status: 403 })
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  // Senza le chiavi dell'app Amazon (e senza la chiave che cifra i token) il collegamento non parte:
  // un token Amazon non deve mai finire nel database in chiaro.
  if (!amazonConfigurato()) return NextResponse.json({ error: 'Amazon non configurato' }, { status: 503 })

  const state = crypto.randomBytes(24).toString('hex')
  // shopify_oauth_state e' chiusa (RLS + niente grant): lo state lo scrive il client di servizio.
  const { error } = await createAdminSupabase().from('shopify_oauth_state').insert({ state, cliente_id: utente.cliente_id, master_id: utente.master_id, shop: 'amazon' })
  if (error) return NextResponse.json({ error: 'Collegamento non avviato, riprova' }, { status: 500 })
  return NextResponse.json({ url: amazonAuthorizeUrl(state) })
}

// Un link che porta qui (GET) non avvia niente: si torna alla pagina, da cui si collega.
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/cliente/integrazioni', req.url))
}
