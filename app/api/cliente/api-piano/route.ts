import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { stripeConfigurato, stripeClient, prezzoStripeApi, aliquotaIva } from '@/lib/stripe'

// IL PACCHETTO API, DAL LATO DEL CLIENTE.
//
// GET  → quanto ho usato, cosa ho, cosa mi servirebbe
// POST → apri la cassa per il pacchetto scelto
//
// Fino a 50 spedizioni al mese non si paga niente: il piano Free non ha una cassa, e chiedere una
// carta a chi non deve pagare sarebbe solo un modo per perderlo.

async function contesto() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).maybeSingle()
  if (!u?.cliente_id || (u.ruolo || '').toLowerCase() !== 'cliente') return null
  return { user, clienteId: u.cliente_id as string, admin: createAdminSupabase() }
}

export async function GET() {
  const ctx = await contesto()
  if (!ctx) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { clienteId, admin } = ctx

  const [{ data: stato }, { data: piani }, { data: cli }, { data: chiavi }] = await Promise.all([
    admin.rpc('fn_stato_api_cliente', { p_cliente: clienteId }),
    admin.from('piani_api').select('codice,nome,limite,prezzo').eq('attivo', true).order('ordine'),
    admin.from('clienti').select('ragione_sociale,api_piano_programmato,api_programmato_dal').eq('id', clienteId).maybeSingle(),
    admin.from('api_keys').select('id,last_used_at').eq('cliente_id', clienteId).neq('attivo', false),
  ])

  // Lo storico: tre mesi bastano a far capire l'andamento senza far leggere una tabella.
  const { data: storico } = await admin.from('contatori_spedizioni_cliente')
    .select('mese,n').eq('cliente_id', clienteId).order('mese', { ascending: false }).limit(4)

  return NextResponse.json({
    stato: stato || null,
    piani: piani || [],
    programmato: cli?.api_piano_programmato ? { piano: cli.api_piano_programmato, dal: cli.api_programmato_dal } : null,
    usaApi: (chiavi || []).some((k: any) => k.last_used_at),
    haChiavi: (chiavi || []).length > 0,
    storico: storico || [],
    pagamentoAttivo: stripeConfigurato(),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await contesto()
  if (!ctx) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { clienteId, admin } = ctx
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non disponibile' }, { status: 400 })

  const { piano: codice } = await req.json().catch(() => ({} as any))
  const { data: piano } = await admin.from('piani_api').select('*').eq('codice', String(codice || '')).eq('attivo', true).maybeSingle()
  if (!piano) return NextResponse.json({ error: 'Pacchetto non valido' }, { status: 400 })
  if (!(Number(piano.prezzo) > 0)) return NextResponse.json({ error: 'Il pacchetto Free non si paga' }, { status: 400 })

  const { data: cli } = await admin.from('clienti')
    .select('id,ragione_sociale,email,piva,api_stripe_customer_id,api_stripe_subscription_id').eq('id', clienteId).maybeSingle()
  if (!cli) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  try {
    const s = stripeClient()
    // Il cliente sul circuito: uno solo per sempre, altrimenti a ogni tentativo ne nasce un altro
    // e lo storico dei pagamenti si spezza in tanti pezzi.
    let customer = cli.api_stripe_customer_id || ''
    if (!customer) {
      const c = await s.customers.create({
        name: cli.ragione_sociale || undefined,
        email: cli.email || undefined,
        metadata: { cliente_id: cli.id, tipo: 'api' },
      })
      customer = c.id
      await admin.from('clienti').update({ api_stripe_customer_id: customer }).eq('id', cli.id)
    }

    // Ha gia' un abbonamento: e' un CAMBIO di pacchetto, non una nuova cassa. Vale subito e si
    // paga la differenza piena, come per i canoni dei master.
    if (cli.api_stripe_subscription_id) {
      const sub = await s.subscriptions.retrieve(cli.api_stripe_subscription_id)
      const prezzo = await prezzoStripeApi(piano as any)
      await s.subscriptions.update(sub.id, {
        items: [{ id: sub.items.data[0].id, price: prezzo.id }],
        proration_behavior: 'none',
        metadata: { cliente_id: cli.id, piano_api: piano.codice },
      })
      await admin.from('clienti').update({ api_piano: piano.codice }).eq('id', cli.id)
      return NextResponse.json({ cambiato: true, piano: piano.codice })
    }

    const prezzo = await prezzoStripeApi(piano as any)
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://moovexpress.com'
    const sessione = await s.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: prezzo.id, quantity: 1 }],
      // La partita IVA serve all'inversione contabile: la societa' che incassa e' estera.
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      // L'aliquota va sull'abbonamento, non sulla sessione. Oggi e' vuota (inversione contabile:
      // la societa' che incassa e' estera), ma passarla nel posto giusto evita che il giorno in cui
      // servisse finisca ignorata.
      subscription_data: {
        metadata: { cliente_id: cli.id, piano_api: piano.codice },
        ...(await aliquotaIva()).length ? { default_tax_rates: await aliquotaIva() } : {},
      },
      metadata: { cliente_id: cli.id, piano_api: piano.codice },
      success_url: `${base}/cliente/impostazioni/api-key?pagato=1`,
      cancel_url: `${base}/cliente/impostazioni/api`,
    })
    return NextResponse.json({ url: sessione.url })
  } catch (e: any) {
    // L'errore vero nei log, uno leggibile a schermo: una cassa che non si apre senza dire perche'
    // e' gia' costata quattro tentativi a vuoto sui canoni dei master.
    console.error('[API][CASSA]', e?.message)
    return NextResponse.json({ error: 'Non riesco ad aprire il pagamento: ' + (e?.message || 'errore') }, { status: 400 })
  }
}
