import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'
import { conguaglioDelMese } from '@/lib/abbonamento-cambi'
import { meseCorrente } from '@/lib/piani'

// RIALLINEA I CONGUAGLI DEGLI UPGRADE — solo il master principale (la piattaforma).
//
// La vecchia strada del checkout (fino al 27/08) su ogni upgrade metteva in conto la differenza
// PIENA di piano come voce in sospeso sul circuito, che non ha mai incassato ma si aggancerebbe al
// prossimo rinnovo: quei master pagherebbero la differenza intera invece della quota proporzionata
// ai giorni. Questa rotta toglie le voci vecchie ("differenza di piano") e mette al loro posto il
// conguaglio giusto, quello che il portale mostra al master come "prossimo pagamento".
//
// GET  = anteprima (sola lettura). POST = applica.
// Idempotente: agisce SOLO sulle voci in sospeso "differenza di piano"; non crea un secondo
// conguaglio se ce n'e' gia' uno; non tocca le voci gia' finite su una fattura.

const RE_VECCHIA = /differenza di piano|passaggio a/i
const RE_NUOVA = /conguaglio/i

// Solo il master principale (root: senza padre). E' lui che incassa i canoni della rete.
async function soloRoot() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', utente.master_id).single()
  if (m?.parent_master_id) return { errore: NextResponse.json({ error: 'Riservato al master principale' }, { status: 403 }) }
  return { admin }
}

// Raccoglie tutte le voci in sospeso "differenza di piano", raggruppate per cliente del circuito.
async function vecchiePerCliente(s: ReturnType<typeof stripeClient>) {
  const mappa = new Map<string, any[]>()
  let starting_after: string | undefined
  for (let pag = 0; pag < 30; pag++) {
    const lista: any = await s.invoiceItems.list({ limit: 100, ...(starting_after ? { starting_after } : {}) })
    for (const it of lista.data) {
      if (it.invoice) continue                         // gia' su una fattura: non si tocca
      if (!RE_VECCHIA.test(it.description || '')) continue
      const cust = typeof it.customer === 'string' ? it.customer : it.customer?.id
      if (!cust) continue
      if (!mappa.has(cust)) mappa.set(cust, [])
      mappa.get(cust)!.push(it)
    }
    if (!lista.has_more) break
    starting_after = lista.data[lista.data.length - 1]?.id
  }
  return mappa
}

// Per un cliente: conguaglio giusto (dai movimenti del mese) + se c'e' gia' un conguaglio nuovo.
async function datiCliente(admin: any, s: any, cust: string, items: any[]) {
  const { data: m } = await admin.from('masters')
    .select('id,nome,stripe_subscription_id').eq('stripe_customer_id', cust).maybeSingle()
  const sommaVecchia = Math.round(items.reduce((t, it) => t + (it.amount || 0), 0)) / 100
  let conguaglio = 0, dettaglio: any[] = [], rinnovo: string | null = null
  if (m) {
    const { data: righe } = await admin.from('abbonamenti_pagamenti')
      .select('piano,created_at').eq('master_id', m.id).eq('mese', meseCorrente())
    const r = conguaglioDelMese(righe || [], meseCorrente()); conguaglio = r.totale; dettaglio = r.dettaglio
    if (m.stripe_subscription_id) {
      try {
        const sub = await s.subscriptions.retrieve(m.stripe_subscription_id, { expand: ['items.data'] })
        const fine = sub.items?.data?.[0]?.current_period_end || sub.current_period_end
        if (fine) rinnovo = new Date(fine * 1000).toISOString().slice(0, 10)
      } catch { }
    }
  }
  const giaNuovo = (await s.invoiceItems.list({ customer: cust, limit: 50 }))
    .data.some((it: any) => !it.invoice && RE_NUOVA.test(it.description || ''))
  return { master: m, sommaVecchia, conguaglio, dettaglio, rinnovo, giaNuovo }
}

export async function GET() {
  const g = await soloRoot(); if (g.errore) return g.errore
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non configurato' }, { status: 400 })
  const s = stripeClient()
  const mappa = await vecchiePerCliente(s)
  const righe: any[] = []
  let totVecchio = 0, totNuovo = 0
  for (const [cust, items] of mappa) {
    const d = await datiCliente(g.admin, s, cust, items)
    totVecchio += d.sommaVecchia; totNuovo += d.conguaglio
    righe.push({
      master_id: d.master?.id || null,
      master: d.master?.nome || `(cliente ${cust})`,
      in_sospeso: d.sommaVecchia, conguaglio: d.conguaglio, dettaglio: d.dettaglio,
      rinnovo: d.rinnovo, gia_allineato: d.giaNuovo, voci: items.length,
    })
  }
  righe.sort((a, b) => b.in_sospeso - a.in_sospeso)
  return NextResponse.json({
    righe, n: righe.length,
    totale_in_sospeso: Math.round(totVecchio * 100) / 100,
    totale_conguaglio: Math.round(totNuovo * 100) / 100,
  })
}

export async function POST(_req: NextRequest) {
  const g = await soloRoot(); if (g.errore) return g.errore
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non configurato' }, { status: 400 })
  const s = stripeClient()
  const mappa = await vecchiePerCliente(s)
  const fatti: any[] = []
  let tolto = 0, messo = 0
  for (const [cust, items] of mappa) {
    const d = await datiCliente(g.admin, s, cust, items)
    // Tolgo le voci a differenza piena in sospeso (non ancora fatturate).
    for (const it of items) { await s.invoiceItems.del(it.id); tolto += (it.amount || 0) / 100 }
    // Metto il conguaglio giusto, se serve e se non c'e' gia'.
    let creato: string | null = null
    if (d.master && d.conguaglio > 0 && !d.giaNuovo) {
      const nuovo = await s.invoiceItems.create({
        customer: cust, amount: Math.round(d.conguaglio * 100), currency: 'eur',
        description: `Conguaglio piano ${meseCorrente()} — differenza sui giorni di utilizzo`,
        metadata: { master_id: d.master.id, tipo: 'conguaglio', mese: meseCorrente(), recupero: '1' },
      })
      creato = nuovo.id; messo += d.conguaglio
    }
    fatti.push({ master: d.master?.nome || cust, tolte: items.length, in_sospeso: d.sommaVecchia, conguaglio: d.conguaglio, creato })
  }
  return NextResponse.json({
    ok: true, fatti, master: fatti.length,
    tolto: Math.round(tolto * 100) / 100, messo: Math.round(messo * 100) / 100,
  })
}
