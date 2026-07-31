import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'

// Area fatture e metodo di pagamento: da qui il master cambia la carta, scarica le sue fatture e
// puo' disdire. E' una pagina del circuito, non nostra — i dati della carta non passano mai da noi.
export async function POST() {
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non ancora attivo.' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('stripe_customer_id').eq('id', utente.master_id).single()
  if (!m?.stripe_customer_id) return NextResponse.json({ error: 'Nessun pagamento con carta registrato.' }, { status: 400 })

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  try {
    const sess = await stripeClient().billingPortal.sessions.create({
      customer: m.stripe_customer_id,
      return_url: `${base}/dashboard/abbonamento`,
      locale: 'it',
    })
    return NextResponse.json({ url: sess.url })
  } catch (e: any) {
    console.error('[STRIPE][PORTALE]', e?.message)
    return NextResponse.json({ error: 'Area fatture non ancora configurata: riprova più tardi o contatta l\'assistenza.' }, { status: 400 })
  }
}
