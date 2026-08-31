import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { stripeConfigurato, stripeClient, primoDelProssimoMese } from '@/lib/stripe'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'

// ALLINEA LA FATTURAZIONE AL 1° — solo il master principale.
//
// Il canone e' MENSILE A FORFAIT: "il mese" si incassa come pagamento a se' (fattura una-tantum col
// canone + il conguaglio in sospeso) sulla CARTA GIA' SALVATA, e l'abbonamento va in PAUSA fino al 1°,
// poi rinnova sempre il 1°. Chi paga a meta' mese ha comunque pagato QUEL mese; allineando tutti al 1°
// paga il mese nuovo. Con la pausa il rinnovo dell'anniversario e' soppresso: nessuno paga due volte.
//
// Ordine e sicurezza (dopo due revisioni avversariali + correzioni di Lorenzo):
//  - ADDEBITA PRIMA, mette in PAUSA solo se INCASSATO: se la carta rifiuta, il master NON viene messo
//    in pausa, resta sul suo ciclo e scatta il congelamento normale dopo 3 giorni (regola invariata);
//  - la fattura una-tantum usa la carta della subscription e l'incasso e' VERIFICATO (stato 'paid');
//  - idempotenza STABILE (chiave di campagna dalla data di pausa, non dal mese di calendario);
//  - eventuale SCHEDULE residuo su Stripe (es. dopo un upgrade) viene RILASCIATO prima della pausa
//    (non e' un downgrade se le fasi hanno lo stesso prezzo — e' un residuo tecnico);
//  - fuori: bonifico/senza-carta/sconti/stati non attivi/chi rinnova gia' il 1°/chi ha gia' pagato
//    oltre la pausa (mai troncare un periodo gia' pagato senza credito);
//  - `solo`=<master_id> per il CANARY mirato: il super master sceglie chi far partire per primo.

const RUOLI_OK = new Set(['master', 'admin'])   // azione di massa sui pagamenti: NON operatore

async function soloRoot() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !RUOLI_OK.has(String(utente.ruolo || '').toLowerCase())) {
    return { errore: NextResponse.json({ error: 'Riservato al master principale' }, { status: 403 }) }
  }
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', utente.master_id).single()
  if (!m || m.parent_master_id) return { errore: NextResponse.json({ error: 'Riservato al master principale' }, { status: 403 }) }  // fail-closed
  return { admin, rootId: utente.master_id }
}

// Il 1° a cui puntare la pausa: il prossimo 1° che dista >48h (Stripe rifiuta trial_end sotto le 48h).
function primo1DopoPausa(): number {
  const oraSec = Math.floor(Date.now() / 1000)
  let t = primoDelProssimoMese()
  if (t < oraSec + 49 * 3600) {
    const d = new Date(t * 1000)
    t = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0) / 1000)
  }
  return t
}

// Mese REALMENTE coperto dalla una-tantum = il mese immediatamente prima della pausa.
function meseCoperto(pausa: number): string {
  const d = new Date((pausa - 86400) * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

async function conguaglioInSospeso(s: any, customer: string): Promise<number> {
  try {
    const items = await s.invoiceItems.list({ customer, limit: 50 })
    return items.data.filter((it: any) => !it.invoice).reduce((t: number, it: any) => t + (it.amount || 0), 0) / 100
  } catch { return 0 }
}

const idDi = (v: any): string | null => (typeof v === 'string' ? v : v?.id) || null

async function cartaDa(s: any, sub: any): Promise<string | null> {
  const subPm = idDi(sub.default_payment_method)
  if (subPm) return subPm
  try {
    const cust: any = await s.customers.retrieve(String(sub.customer))
    return idDi(cust?.invoice_settings?.default_payment_method) || idDi(cust?.default_source)
  } catch { return null }
}

async function analizza(admin: any, s: any, rootId: string) {
  const ids = await sottoAlberoMasterIds(admin, rootId)
  const { data: masters } = await admin.from('masters')
    .select('id,nome,abbonamento_prezzo,abbonamento_esente,stripe_subscription_id,stripe_stato')
    .in('id', ids).neq('id', rootId)
  const paganti = (masters || []).filter((m: any) =>
    !m.abbonamento_esente && m.stripe_subscription_id && m.stripe_stato !== 'canceled')

  const pausa = primo1DopoPausa()
  const mese = meseCoperto(pausa)
  const CAMPAGNA = 'allinea_' + pausa

  const righe: any[] = []
  for (const m of paganti) {
    let sub: any = null
    try { sub = await s.subscriptions.retrieve(m.stripe_subscription_id, { expand: ['items.data.price'] }) } catch { continue }
    const voce = sub.items?.data?.[0]
    const canone = Number(voce?.price?.unit_amount || 0) / 100 || Number(m.abbonamento_prezzo || 0)
    const fine = (voce as any)?.current_period_end || sub.current_period_end
    const conguaglio = await conguaglioInSospeso(s, String(sub.customer))
    const pm = await cartaDa(s, sub)

    // Motivi per NON toccarlo (lo schedule residuo NON esclude: lo si rilascia).
    let escluso: string | null = null
    if (sub.collection_method && sub.collection_method !== 'charge_automatically') escluso = 'bonifico'
    else if (!pm) escluso = 'no_carta'
    else if (sub.discount) escluso = 'sconto'
    else if (!(sub.status === 'active' || (sub.status === 'trialing' && sub.trial_end === pausa))) escluso = 'stato_' + sub.status

    const giornoRinnovo = fine ? new Date(fine * 1000).getUTCDate() : null
    const giaAlPrimo = giornoRinnovo === 1
    const giaPagato = !!fine && fine >= pausa

    righe.push({
      master_id: m.id, subscription: sub.id, customer: String(sub.customer), pm,
      schedule: idDi(sub.schedule),
      nome: m.nome, canone, conguaglio,
      addebito: (giaAlPrimo || giaPagato || escluso) ? 0 : Math.round((canone + conguaglio) * 100) / 100,
      stato: sub.status, rinnovo_attuale: fine ? new Date(fine * 1000).toISOString().slice(0, 10) : null,
      escluso, gia_al_primo: giaAlPrimo, gia_pagato: giaPagato, sub_trial_end: sub.trial_end,
    })
  }
  righe.sort((a, b) => (a.rinnovo_attuale || '').localeCompare(b.rinnovo_attuale || ''))
  return { righe, pausa, mese, CAMPAGNA }
}

export async function GET() {
  const g = await soloRoot(); if (g.errore) return g.errore
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non configurato' }, { status: 400 })
  const s = stripeClient()
  const { righe, pausa, mese } = await analizza(g.admin, s, g.rootId)
  const daFare = righe.filter(r => !r.escluso && !r.gia_al_primo && !r.gia_pagato)
  return NextResponse.json({
    mese_una_tantum: mese,
    pausa_fino_al: new Date(pausa * 1000).toISOString().slice(0, 10),
    righe, n: righe.length, n_da_fare: daFare.length,
    totale_addebito: Math.round(daFare.reduce((t, r) => t + r.addebito, 0) * 100) / 100,
    esclusi: righe.filter(r => r.escluso).map(r => ({ nome: r.nome, motivo: r.escluso })),
  })
}

export async function POST(req: NextRequest) {
  const g = await soloRoot(); if (g.errore) return g.errore
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non configurato' }, { status: 400 })
  const s = stripeClient()
  const corpo = await req.json().catch(() => ({} as any))
  const escludiManuale: Set<string> = new Set(Array.isArray(corpo?.escludi) ? corpo.escludi : [])
  const limite = Number.isFinite(corpo?.limite) ? Math.max(0, Number(corpo.limite)) : Infinity
  const solo: string | null = corpo?.solo ? String(corpo.solo) : null   // CANARY mirato

  const { righe, pausa, mese, CAMPAGNA } = await analizza(g.admin, s, g.rootId)
  const fatti: any[] = []
  let tentati = 0
  for (const r of righe) {
    if (solo && r.master_id !== solo) continue
    if (r.escluso) { fatti.push({ nome: r.nome, esito: 'saltato_' + r.escluso }); continue }
    if (escludiManuale.has(r.master_id)) { fatti.push({ nome: r.nome, esito: 'escluso_manuale' }); continue }
    if (r.gia_al_primo) { fatti.push({ nome: r.nome, esito: 'gia_al_primo' }); continue }
    if (r.gia_pagato) { fatti.push({ nome: r.nome, esito: 'gia_pagato_intatto' }); continue }
    if (tentati >= limite) { fatti.push({ nome: r.nome, esito: 'oltre_limite' }); continue }
    tentati++
    try {
      // 1) UNA-TANTUM del mese (idempotente per campagna), carta della subscription, incasso VERIFICATO.
      let incassato = false
      const items = (await s.invoiceItems.list({ customer: r.customer, limit: 100 })).data
      const esiste = items.find((it: any) => it.metadata?.tipo === 'canone_una_tantum' && it.metadata?.campagna === CAMPAGNA)
      if (esiste && esiste.invoice) {
        // Voce gia' su una fattura: incassata solo se la fattura e' 'paid'; altrimenti ritenta il pagamento.
        const inv: any = await s.invoices.retrieve(idDi(esiste.invoice)!)
        if (inv.status === 'paid') incassato = true
        else { try { const p = await s.invoices.pay(inv.id, { off_session: true, payment_method: r.pm || undefined }); incassato = p.status === 'paid' } catch { incassato = false } }
      } else {
        if (!esiste) {
          await s.invoiceItems.create({
            customer: r.customer, amount: Math.round(r.canone * 100), currency: 'eur',
            description: `Canone ${mese}`,
            metadata: { master_id: r.master_id, tipo: 'canone_una_tantum', mese, campagna: CAMPAGNA },
          })
        }
        const inv = await s.invoices.create({
          customer: r.customer, collection_method: 'charge_automatically', auto_advance: false,
          default_payment_method: r.pm || undefined, metadata: { campagna: CAMPAGNA, master_id: r.master_id },
        })
        if (inv.id) await s.invoices.finalizeInvoice(inv.id)
        try { const p = await s.invoices.pay(inv.id!, { off_session: true, payment_method: r.pm || undefined }); incassato = p.status === 'paid' } catch { incassato = false }
      }
      // Se la carta rifiuta: NON mettere in pausa. Resta sul suo ciclo -> congelamento normale dopo 3 giorni.
      if (!incassato) { fatti.push({ nome: r.nome, esito: 'non_incassato' }); continue }

      // 2) PAUSA fino al 1° (solo se incassato). Prima si rilascia un eventuale schedule residuo.
      if (r.schedule) { try { await s.subscriptionSchedules.release(r.schedule) } catch { } }
      if (r.sub_trial_end !== pausa) {
        await s.subscriptions.update(r.subscription, { trial_end: pausa, proration_behavior: 'none' })
      }
      fatti.push({ nome: r.nome, esito: 'fatto', addebito: r.addebito })
    } catch (e: any) {
      fatti.push({ nome: r.nome, esito: 'errore', messaggio: e?.message })
    }
  }
  return NextResponse.json({
    ok: true, pausa_fino_al: new Date(pausa * 1000).toISOString().slice(0, 10), mese_una_tantum: mese,
    fatti,
    n_fatti: fatti.filter(f => f.esito === 'fatto').length,
    non_incassati: fatti.filter(f => f.esito === 'non_incassato').map(f => f.nome),
    errori: fatti.filter(f => f.esito === 'errore'),
  })
}
