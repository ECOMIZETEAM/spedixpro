import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonCallbackAppstore, amazonConfigurato } from '@/lib/amazon'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "OAuth Login URI" dell'app Amazon: la pagina che Amazon apre quando il venditore autorizza
// partendo dall'APPSTORE (o rinnova l'autorizzazione). Amazon passa `amazon_callback_uri` e
// `amazon_state` (piu' `version=beta` finche' l'app e' in bozza); noi riconosciamo il cliente dalla
// sessione, gli diamo uno `state` nostro e lo rimandiamo ad Amazon, che chiude il giro sul
// callback come per il collegamento dal portale.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const callbackAmazon = url.searchParams.get('amazon_callback_uri') || ''
  const statoAmazon = url.searchParams.get('amazon_state') || ''
  if (!callbackAmazon || !statoAmazon || !amazonConfigurato()) {
    return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+valido', req.url))
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  // Senza sessione non sappiamo a quale cliente collegare l'account: si accede e si collega dalla
  // pagina Integrazioni (stesso risultato, partendo dal portale).
  if (!user) return NextResponse.redirect(new URL('/cliente?error=amazon_accedi', req.url))
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) return NextResponse.redirect(new URL('/cliente?error=amazon_accedi', req.url))

  const state = crypto.randomBytes(24).toString('hex')
  const ritorno = amazonCallbackAppstore(callbackAmazon, statoAmazon, state, url.searchParams.get('version'))
  if (!ritorno) return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+valido', req.url))
  await createAdminSupabase().from('shopify_oauth_state').insert({ state, cliente_id: utente.cliente_id, master_id: utente.master_id, shop: 'amazon' })
  return NextResponse.redirect(ritorno)
}
