import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COSTO_SMS_EUR } from '@/lib/sms'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

// ACQUISTO PACCHETTI SMS — pagamento con CARTA (Stripe), NON dal wallet.
//
// Gli SMS sono un contatore privato di CHI li manda: il CLIENTE per sé, o il MASTER per i suoi
// clienti diretti. Ognuno compra i suoi; niente più trasferimenti dal master. I soldi vanno a E&A
// via Stripe (come l'abbonamento), senza toccare il wallet spedizioni né `movimenti`.
//
// Qui si APRE solo la cassa: l'accredito degli SMS avviene a pagamento confermato, nel webhook
// firmato (/api/stripe/webhook), mai aprendo la pagina — altrimenti basterebbe aprirla e chiuderla.
const PACCHETTI = [1000, 5000, 10000]   // ≥1000, come deciso

export async function POST(req: NextRequest) {
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non ancora attivo.' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).maybeSingle()
  const ruolo = (u?.ruolo || '').toLowerCase()

  const body = await req.json().catch(() => ({} as any))
  const quantita = Math.floor(Number(body?.quantita))
  if (!PACCHETTI.includes(quantita)) {
    return NextResponse.json({ error: 'Pacchetto non valido (minimo 1000 SMS).' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const s = stripeClient()
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const importoCent = Math.round(quantita * COSTO_SMS_EUR * 100)   // 1000 × 0,10 € = 100,00 €

  // Chi compra: il CLIENTE (se l'utente è del portale cliente) o il MASTER (staff del master).
  let customer: string
  const metadata: Record<string, string> = { scopo: 'sms', quantita_sms: String(quantita) }
  let successPath: string

  if (u?.cliente_id) {
    const { data: cli } = await admin.from('clienti').select('id,ragione_sociale,email,stripe_customer_id').eq('id', u.cliente_id).maybeSingle()
    if (!cli) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
    customer = cli.stripe_customer_id || ''
    if (!customer) {
      const c = await s.customers.create({ name: cli.ragione_sociale || undefined, email: cli.email || undefined, metadata: { cliente_id: cli.id } })
      customer = c.id
      await admin.from('clienti').update({ stripe_customer_id: customer }).eq('id', cli.id).is('stripe_customer_id', null)
    }
    metadata.cliente_id = cli.id
    successPath = '/cliente/sms?acquisto=ok'
  } else if (u?.master_id && ['master', 'admin', 'operatore'].includes(ruolo)) {
    const { data: m } = await admin.from('masters').select('id,nome,email,stripe_customer_id').eq('id', u.master_id).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
    customer = m.stripe_customer_id || ''
    if (!customer) {
      const c = await s.customers.create({ name: m.nome || undefined, email: m.email || undefined, metadata: { master_id: m.id } })
      customer = c.id
      await admin.from('masters').update({ stripe_customer_id: customer }).eq('id', m.id).is('stripe_customer_id', null)
    }
    metadata.master_id = m.id
    successPath = '/dashboard/reports/storico-sms?acquisto=ok'
  } else {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  try {
    const sessione = await s.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: importoCent,
          tax_behavior: 'inclusive',   // IVA gestita a livello sistema (reverse charge UK = 0)
          product_data: { name: `MoovExpress — ${quantita.toLocaleString('it-IT')} SMS di notifica` },
        },
      }],
      metadata,
      // Salva la carta per gli addebiti futuri fuori sessione (auto-ricarica sotto soglia).
      payment_intent_data: { setup_future_usage: 'off_session', metadata },
      success_url: `${base}${successPath}`,
      cancel_url: `${base}${successPath.split('?')[0]}`,
      locale: 'it',
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },     // partita IVA in fattura (reverse charge)
      customer_update: { name: 'auto', address: 'auto' },
    })
    return NextResponse.json({ url: sessione.url })
  } catch (e: any) {
    console.error('[SMS][CASSA]', metadata.cliente_id || metadata.master_id, e?.message)
    return NextResponse.json({ error: 'Non riesco ad aprire il pagamento in questo momento. Riprova.' }, { status: 400 })
  }
}
