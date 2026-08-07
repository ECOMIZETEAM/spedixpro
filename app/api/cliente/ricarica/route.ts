import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'

/* RICARICA DEL CREDITO con carta.
 *
 * Apre una pagina di pagamento Stripe (Checkout) e, pagando, SALVA anche la carta per gli addebiti
 * futuri — ripesature del fornitore, resi — che oggi si rincorrono a mano. Un gesto solo:
 * si ricarica e si lascia la carta pronta.
 *
 * Il credito NON si muove qui. Si accredita nel webhook, quando il circuito conferma che il denaro
 * si e' mosso davvero (come per i canoni). Aprire questa pagina e chiuderla non deve regalare
 * credito. E l'accredito passa SOLO dalla RPC atomica del credito, mai da un UPDATE a mano. */

const MIN = 10       // ricarica minima concordata
const MAX = 5000     // oltre, meglio parlarne: bonifico o pratica dedicata

export async function POST(req: NextRequest) {
  if (!stripeConfigurato()) {
    return NextResponse.json({ error: 'Il pagamento con carta non è ancora attivo.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).maybeSingle()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const corpo = await req.json().catch(() => ({} as any))
  const importo = Math.round(Number(corpo?.importo) || 0)
  if (!(importo >= MIN)) return NextResponse.json({ error: `La ricarica minima è di ${MIN} €.` }, { status: 400 })
  if (importo > MAX) return NextResponse.json({ error: `Per ricariche oltre ${MAX} € scrivici: te la gestiamo su misura.` }, { status: 400 })

  // Client ADMIN per leggere/scrivere il customer Stripe del cliente (colonna che il cliente non
  // può toccare da solo). Il perimetro resta il SUO cliente_id, preso dalla sessione.
  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti')
    .select('id, master_id, ragione_sociale, email, stripe_customer_id')
    .eq('id', u.cliente_id).maybeSingle()
  if (!cli) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  const s = stripeClient()

  // Un customer Stripe per cliente, creato la prima volta e poi riusato: è quello che tiene insieme
  // la carta salvata e le ricariche. NON è api_stripe_customer_id (quello è degli abbonamenti API).
  let customer = cli.stripe_customer_id
  if (!customer) {
    const c = await s.customers.create({
      name: cli.ragione_sociale || undefined,
      email: cli.email || undefined,
      metadata: { cliente_id: cli.id },
    })
    customer = c.id
    // `is null` per non sovrascrivere se due richieste partono insieme: vince la prima.
    await admin.from('clienti').update({ stripe_customer_id: customer }).eq('id', cli.id).is('stripe_customer_id', null)
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')

  const sessione = await s.checkout.sessions.create({
    mode: 'payment',
    customer,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: importo * 100,
        product_data: { name: 'Ricarica credito MoovExpress' },
      },
    }],
    // LA CARTA RESTA SALVATA per gli addebiti futuri fuori sessione (ripesature, resi).
    payment_intent_data: {
      setup_future_usage: 'off_session',
      metadata: { scopo: 'ricarica', cliente_id: cli.id },
    },
    // Il webhook riconosce la ricarica da `scopo`, PRIMA di smistare per customer: senza, una
    // ricarica finirebbe nel ramo dei pacchetti API (ha anche cliente_id) e combinerebbe guai.
    metadata: { scopo: 'ricarica', cliente_id: cli.id, master_id: cli.master_id, importo: String(importo) },
    success_url: `${base}/cliente/ricarica?stato=ok`,
    cancel_url: `${base}/cliente/ricarica?stato=annullata`,
  })

  return NextResponse.json({ url: sessione.url })
}
