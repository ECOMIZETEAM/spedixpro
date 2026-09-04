import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

// CANONE IN SOSPESO — "Paga / Riprova".
//
// Se l'addebito del canone e' fallito (es. carta con fondi insufficienti), su Stripe resta una fattura
// APERTA e il circuito non ritenta da solo. Il master non riusciva a rimediare: il checkout lo bloccava
// con "Hai gia' questo piano". Qui restituiamo il LINK di pagamento Stripe (hosted invoice) di quella
// fattura, cosi' puo' saldarla da solo — anche con una carta DIVERSA (la pagina Stripe lo permette).
//
// Read-only: non addebita nulla noi (nessuna carica lato server); paga il master sulla pagina Stripe.
export async function GET(_req: NextRequest) {
  if (!stripeConfigurato()) return NextResponse.json({ sospeso: false })
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  // Il canone lo paga il MASTER (non cliente/agente). Il campo master_id ce l'hanno anche i clienti.
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) return NextResponse.json({ sospeso: false })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('stripe_customer_id').eq('id', utente.master_id).maybeSingle()
  if (!m?.stripe_customer_id) return NextResponse.json({ sospeso: false })

  try {
    const s = stripeClient()
    const open = await s.invoices.list({ customer: m.stripe_customer_id, status: 'open', limit: 1 })
    const inv = open.data[0] as any
    if (!inv?.hosted_invoice_url) return NextResponse.json({ sospeso: false })
    return NextResponse.json({ sospeso: true, importo: Number(inv.amount_due || 0) / 100, url: inv.hosted_invoice_url })
  } catch (e: any) {
    console.error('[PAGA-SOSPESO]', e?.message)
    return NextResponse.json({ sospeso: false })
  }
}
