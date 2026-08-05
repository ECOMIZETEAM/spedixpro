import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { stripeClient, stripeConfigurato } from '@/lib/stripe'

// CHI PAGA LE API, DECISO A MANO.
//
// La regola: le API le paga chi RIVENDE le spedizioni fuori dal portale, non chi le usa per
// spedire la propria merce. La differenza non e' calcolabile — una chiamata e' identica nei due
// casi — quindi la decide una persona, e questa rotta e' il posto dove lo dice.
//
// LA DECIDE SOLO IL SUPER MASTER. Non il master di riferimento del cliente: i soldi dei pacchetti
// API vanno alla piattaforma (su Stripe non c'e' nessuno split verso il master), quindi non e' una
// leva che puo' stare in mano a chi non li incassa. Il controllo si fa qui a mano perche' si passa
// dalla chiave di servizio, che scavalca le regole del database.

// IL RUOLO, NON SOLO IL MASTER.
//
// `master_id` non e' un permesso: e' l'appartenenza al tenant, e ce l'hanno anche i clienti, gli
// agenti e gli autisti. Sotto MoovExpress ci sono quattro utenti con ruolo 'cliente' — e non per
// caso: `lib/shopifyProvision.ts` ne crea uno AUTOMATICAMENTE, sotto il master radice, per ogni
// negozio che installa l'app Shopify pubblica, e poi lo fa entrare nel portale. Guardando solo
// `is_super_master` del suo master, ognuno di loro sarebbe passato di qui: avrebbe letto i volumi
// e i prezzi di ventuno clienti di sei master diversi — concorrenti fra loro — e avrebbe potuto
// accendere il pagamento a un cliente altrui, o spegnerlo a tutti.
const RUOLI_AMMESSI = ['master', 'admin']

async function superMaster(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!u?.master_id) return null
  if (!RUOLI_AMMESSI.includes(String(u.ruolo || '').toLowerCase())) return null
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('is_super_master').eq('id', u.master_id).maybeSingle()
  return m?.is_super_master ? { user, admin } : null
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await superMaster(supabase)
  if (!s) return NextResponse.json({ error: 'Sezione riservata' }, { status: 403 })

  const giorni = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get('giorni')) || 60))
  const { data, error } = await s.admin.rpc('fn_api_clienti_pannello', { p_giorni: giorni })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: piani } = await s.admin.from('piani_api')
    .select('codice,nome,limite,prezzo').eq('attivo', true).order('ordine')

  return NextResponse.json({ clienti: data || [], piani: piani || [], giorni })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await superMaster(supabase)
  if (!s) return NextResponse.json({ error: 'Sezione riservata' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const clienteId = String(b.cliente_id || '')
  const paga = !!b.paga
  if (!clienteId) return NextResponse.json({ error: 'Cliente mancante' }, { status: 400 })

  const { data: cli } = await s.admin.from('clienti')
    .select('id,ragione_sociale,api_esente,api_piano,api_stripe_subscription_id').eq('id', clienteId).maybeSingle()
  if (!cli) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  // METTERLO GRATIS DEVE ANCHE SMETTERE DI ADDEBITARGLI.
  //
  // L'esenzione e' una riga nel nostro database: da sola non dice niente a Stripe, dove
  // l'abbonamento continua a incassare ogni mese. Un cliente dichiarato "non paga" che si vede
  // addebitare lo stesso e' il modo piu' rapido di perderlo — e ha ragione lui.
  // Si chiude a fine periodo, non subito: il mese in corso l'ha gia' pagato, e cosi' non ci sono
  // rimborsi da inseguire. Se il circuito non risponde ci si FERMA: meglio non aver cambiato
  // niente che dichiararlo gratis mentre la carta continua a girare.
  let disdettaDal: string | null = null
  if (!paga && cli.api_stripe_subscription_id && stripeConfigurato()) {
    try {
      const st = stripeClient()
      const agg: any = await st.subscriptions.update(cli.api_stripe_subscription_id, { cancel_at_period_end: true })
      const fine = agg?.cancel_at || agg?.current_period_end || agg?.items?.data?.[0]?.current_period_end
      if (fine) disdettaDal = new Date(Number(fine) * 1000).toISOString()
    } catch (e: any) {
      console.error('[API][ESENZIONE] disdetta non riuscita', clienteId, e?.message)
      return NextResponse.json({
        error: 'Non riesco a chiudere l\'abbonamento sul circuito di pagamento: non ho cambiato niente. Riprova.',
      }, { status: 400 })
    }
  }

  // IL PREAVVISO RIPARTE DA ADESSO.
  // Il conto alla rovescia si segna alla prima chiamata fatta fuori pacchetto (o al pagamento
  // fallito) e resta scritto. Senza azzerarlo, accendere il pagamento a un cliente che sforava da
  // mesi lo fermerebbe nello stesso istante, senza preavviso: si e' deciso ORA che paga, e il tempo
  // per mettersi in regola deve decorrere da ora.
  //
  // Si azzerano ENTRAMBI i segni. Il primo giro guardava solo lo sforamento e lasciava
  // `api_scaduto_dal`: un cliente a cui una carta era andata a vuoto mesi prima — magari quando
  // pagava, prima di essere messo gratis — si sarebbe ritrovato fermo al primo click, per un
  // pagamento che nel frattempo non gli era piu' stato chiesto.
  const patch: any = { api_esente: !paga }
  if (paga) { patch.api_limite_sforato_dal = null; patch.api_scaduto_dal = null }

  const { error } = await s.admin.from('clienti').update(patch).eq('id', clienteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Resta scritto chi l'ha deciso e quando: e' una decisione che vale soldi, e fra sei mesi
  // "perche' questo non paga?" deve avere una risposta che non sia la memoria di qualcuno.
  await s.admin.from('audit_log').insert({
    attore_uid: s.user.id, attore: s.user.email || null,
    azione: paga ? 'api_pagamento_acceso' : 'api_pagamento_spento',
    tabella: 'clienti', record_id: clienteId,
    modifiche: {
      cliente: cli.ragione_sociale,
      api_esente: { da: cli.api_esente, a: !paga },
      ...(disdettaDal ? { abbonamento_chiuso_dal: disdettaDal } : {}),
    },
  }).then(() => {}, (e: any) => console.error('[API][ESENZIONE] audit non scritto', e?.message))

  const { data: stato } = await s.admin.rpc('fn_stato_api_cliente', { p_cliente: clienteId })
  return NextResponse.json({ ok: true, cliente: cli.ragione_sociale, paga, disdettaDal, stato: stato || null })
}
