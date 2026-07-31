import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'
import { pianoById, meseCorrente } from '@/lib/piani'
import { stripeConfigurato, stripeClient, prezzoStripe, aliquotaIva, clienteStripe, primoDelProssimoMese, idPrezzo } from '@/lib/stripe'

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
    .select('id,nome,email,parent_master_id,abbonamento_esente,abbonamento_piano,abbonamento_mese,stripe_customer_id,stripe_subscription_id,stripe_stato')
    .eq('id', utente.master_id).single()
  if (!m) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  if (!m.parent_master_id) return NextResponse.json({ error: 'Il master principale non ha canone.' }, { status: 400 })
  if (m.abbonamento_esente) return NextResponse.json({ error: 'Il tuo abbonamento è gratuito: nessun pagamento da fare.' }, { status: 400 })
  if (m.abbonamento_piano === pianoId && m.stripe_subscription_id) return NextResponse.json({ error: 'Hai già questo piano' }, { status: 400 })

  const meseGiaPagato = !!m.abbonamento_piano && m.abbonamento_mese === meseCorrente()

  const s = stripeClient()
  const { price } = await prezzoStripe(pianoId)
  const iva = await aliquotaIva()
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')

  // ── Ha gia' un abbonamento attivo: si cambia il piano su quello ──
  //
  // UPGRADE e DOWNGRADE non sono simmetrici, e non e' un dettaglio:
  //
  //  · l'UPGRADE deve valere SUBITO — di norma lo si fa perche' si sta per sfondare il limite e le
  //    spedizioni stanno per fermarsi. Aspettare il mese prossimo lo renderebbe inutile. Si paga
  //    subito la differenza per i giorni che restano, non un mese intero.
  //
  //  · il DOWNGRADE parte dal PRIMO DEL MESE DOPO. Il mese in corso e' gia' stato pagato al prezzo
  //    alto: abbassare il limite adesso vorrebbe dire togliere qualcosa di gia' pagato, e per di
  //    piu' rischiare di bloccare una rete che aveva gia' spedito oltre il nuovo limite.
  if (m.stripe_subscription_id) {
    try {
      const sub = await s.subscriptions.retrieve(m.stripe_subscription_id, { expand: ['items.data.price'] })
      if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
        const voce = sub.items.data[0]
        const prezzoOra = Number((voce.price as any)?.unit_amount || 0)
        const inSalita = (price.unit_amount || 0) > prezzoOra

        if (inSalita) {
          // Un eventuale downgrade programmato va tolto di mezzo, altrimenti resterebbe li' ad
          // aspettare e il mese prossimo riporterebbe giu' un piano appena alzato.
          if (sub.schedule) {
            try { await s.subscriptionSchedules.release(String(sub.schedule)) } catch { }
          }
          await s.subscriptions.update(sub.id, {
            items: [{ id: voce.id, price: price.id }],
            proration_behavior: 'always_invoice',   // emette e incassa SUBITO la differenza
            metadata: { master_id: m.id, piano: pianoId },
          })
          await admin.from('masters').update({
            abbonamento_piano_programmato: null, abbonamento_programmato_dal: null,
          }).eq('id', m.id)
          return NextResponse.json({ aggiornato: true, immediato: true })
        }

        // Downgrade: si programma per la fine del periodo pagato.
        const sched = sub.schedule
          ? await s.subscriptionSchedules.retrieve(String(sub.schedule))
          : await s.subscriptionSchedules.create({ from_subscription: sub.id })
        // La fase da tenere e' quella IN CORSO, non l'ultima: con il rinnovo agganciato al primo del
        // mese le fasi sono due (il pezzo di mese iniziale e poi il primo mese pieno), e prendere
        // l'ultima faceva rifiutare l'operazione — si stava spostando l'inizio di una fase gia'
        // cominciata. Il piano nuovo deve partire dalla fine di QUELLA in corso.
        const corrente = sched.phases.find(f => f.start_date === sched.current_phase?.start_date) || sched.phases[0]
        await s.subscriptionSchedules.update(sched.id, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price: idPrezzo((corrente.items[0] as any).price), quantity: 1 }],
              start_date: corrente.start_date, end_date: corrente.end_date,
            },
            { items: [{ price: price.id, quantity: 1 }] },
          ],
          metadata: { master_id: m.id, piano: pianoId },
        })
        const dal = new Date(Number(corrente.end_date) * 1000).toISOString()
        await admin.from('masters').update({
          abbonamento_piano_programmato: pianoId, abbonamento_programmato_dal: dal,
        }).eq('id', m.id)
        return NextResponse.json({ aggiornato: true, immediato: false, dal })
      }
    } catch (e: any) {
      console.error('[STRIPE] cambio piano fallito', m.id, e?.message)
      return NextResponse.json({ error: 'Cambio piano non riuscito: riprova o contatta l\'assistenza.' }, { status: 400 })
    }
  }

  // ── Prima attivazione: pagina di pagamento ──
  const customer = await clienteStripe(admin, m as any)
  const sessione = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: price.id, quantity: 1, tax_rates: iva.length ? iva : undefined }],
    subscription_data: {
      metadata: { master_id: m.id, piano: pianoId },
      // Rinnovo il PRIMO DEL MESE per tutti, come il contatore delle spedizioni: se il pacchetto
      // riparte il primo e la bolletta arriva il 13, i due numeri non tornano mai fra loro.
      billing_cycle_anchor: primoDelProssimoMese(),
      // Chi questo mese ha GIA' pagato il canone col credito e ora passa alla carta non deve
      // pagare una seconda volta i giorni che ha gia' pagato: non si addebita nulla adesso e la
      // carta parte dal primo del mese. Senza questo, passare al pagamento con carta a meta' mese
      // costava due volte lo stesso periodo.
      proration_behavior: meseGiaPagato ? 'none' : 'create_prorations',
    },
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
