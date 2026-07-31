import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'
import { pianoById } from '@/lib/piani'
import { stripeConfigurato, stripeClient, prezzoStripe, aliquotaIva, clienteStripe } from '@/lib/stripe'

// Attivazione o cambio piano PAGANDO CON CARTA.
//
// Chi ha gia' l'abbonamento non ripassa dalla cassa: si cambia il piano sull'abbonamento che ha
// gia', e il circuito calcola da solo il conguaglio dei giorni rimanenti del mese. Chi non ce l'ha
// viene mandato alla pagina di pagamento.
//
// Il piano NON si attiva qui: si attiva quando il pagamento e' andato a buon fine, e a dirlo e' il
// circuito con una notifica firmata (/api/stripe/webhook). Attivarlo qui vorrebbe dire regalare il
// piano a chi apre la pagina di pagamento e poi chiude la finestra.
export async function POST(req: NextRequest) {
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non ancora attivo.' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { pianoId } = await req.json().catch(() => ({} as any))
  const piano = pianoById(String(pianoId || ''))
  if (!piano || !String(pianoId).startsWith('enterprise_')) return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('id,nome,email,parent_master_id,abbonamento_esente,abbonamento_piano,stripe_customer_id,stripe_subscription_id,stripe_stato')
    .eq('id', utente.master_id).single()
  if (!m) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  if (!m.parent_master_id) return NextResponse.json({ error: 'Il master principale non ha canone.' }, { status: 400 })
  if (m.abbonamento_esente) return NextResponse.json({ error: 'Il tuo abbonamento è gratuito: nessun pagamento da fare.' }, { status: 400 })
  if (m.abbonamento_piano === pianoId && m.stripe_subscription_id) return NextResponse.json({ error: 'Hai già questo piano' }, { status: 400 })

  const s = stripeClient()
  const { price } = await prezzoStripe(pianoId)
  const iva = await aliquotaIva()
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')

  // ── Ha gia' un abbonamento attivo: si cambia il piano su quello ──
  if (m.stripe_subscription_id) {
    try {
      const sub = await s.subscriptions.retrieve(m.stripe_subscription_id)
      if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
        const voce = sub.items.data[0]
        await s.subscriptions.update(sub.id, {
          items: [{ id: voce.id, price: price.id }],
          // Conguaglio sui giorni: chi passa a un piano superiore a meta' mese paga la differenza
          // per i giorni che restano, non un mese intero.
          proration_behavior: 'create_prorations',
          metadata: { master_id: m.id, piano: pianoId },
        })
        return NextResponse.json({ aggiornato: true })
      }
    } catch (e: any) {
      console.error('[STRIPE] cambio piano fallito', m.id, e?.message)
      // L'abbonamento non esiste piu' sul circuito: si riparte da una nuova sottoscrizione.
    }
  }

  // ── Prima attivazione: pagina di pagamento ──
  const customer = await clienteStripe(admin, m as any)
  const sessione = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: price.id, quantity: 1, tax_rates: iva.length ? iva : undefined }],
    subscription_data: { metadata: { master_id: m.id, piano: pianoId } },
    metadata: { master_id: m.id, piano: pianoId },
    success_url: `${base}/dashboard/abbonamento?pagamento=ok`,
    cancel_url: `${base}/dashboard/abbonamento?pagamento=annullato`,
    locale: 'it',
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },   // partita IVA in fattura
  })
  return NextResponse.json({ url: sessione.url })
}
