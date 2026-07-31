import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'
import { DISDETTA, primoDelMeseProssimo } from '@/lib/abbonamento-cambi'

// DISDETTA.
//
// Prima toglieva il piano all'istante: si premeva il tasto e il portale si bloccava subito, pur
// avendo pagato il mese in corso. Ora vale dal PRIMO DEL MESE DOPO — come il downgrade, e per lo
// stesso motivo: il mese e' pagato, e chi l'ha pagato lo usa fino in fondo. Nessun rimborso, ma
// nemmeno un servizio tolto prima del tempo.
//
// Chi paga con carta viene disdetto anche sul circuito: senza, la carta continuerebbe a essere
// addebitata ogni mese per un abbonamento che l'utente crede chiuso.
export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('id,abbonamento_piano,stripe_subscription_id').eq('id', utente.master_id).single()
  if (!m?.abbonamento_piano) return NextResponse.json({ error: 'Nessun abbonamento da disdire' }, { status: 400 })

  let dal = primoDelMeseProssimo().toISOString()

  if (m.stripe_subscription_id && stripeConfigurato()) {
    try {
      const s = stripeClient()
      const sub = await s.subscriptions.retrieve(m.stripe_subscription_id)
      // Un cambio piano programmato non ha piu' senso se l'abbonamento si chiude.
      if (sub.schedule) { try { await s.subscriptionSchedules.release(String(sub.schedule)) } catch { } }
      const agg: any = await s.subscriptions.update(m.stripe_subscription_id, { cancel_at_period_end: true })
      const fine = agg?.cancel_at || agg?.current_period_end || agg?.items?.data?.[0]?.current_period_end
      if (fine) dal = new Date(Number(fine) * 1000).toISOString()
    } catch (e: any) {
      console.error('[ABBONAMENTO] disdetta sul circuito fallita', m.id, e?.message)
      return NextResponse.json({ error: 'Disdetta non riuscita: riprova o contatta l\'assistenza.' }, { status: 400 })
    }
  }

  await admin.from('masters').update({
    abbonamento_piano_programmato: DISDETTA, abbonamento_programmato_dal: dal,
  }).eq('id', utente.master_id)

  return NextResponse.json({ success: true, dal })
}
