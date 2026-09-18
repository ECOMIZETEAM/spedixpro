import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'

// STATISTICHE — CONTRASSEGNI & RISCHIO (sola lettura). Incasso e rimessa contrassegni sul sottoalbero.
//
// Aggregazione nel DB (RPC contrassegni_dettaglio_v1): kpi (totale/rimesso/in attesa/esposizione),
// importo per corriere, aging degli inevasi, top clienti e i piu' vecchi non rimessi. Prima si
// scaricavano in memoria TUTTE le spedizioni con contrassegno del sotto-albero, mille per round-trip.
const n = (x: any) => Number(x || 0)
const r2 = (x: number) => Math.round(x * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00Z').toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59Z').toISOString() : new Date().toISOString()

  const admin = createAdminSupabase()
  const sub = await sottoAlberoMasterIds(admin, M)
  const { data: d, error } = await admin.rpc('contrassegni_dettaglio_v1', { p_sub: sub.length ? sub : [M], p_dal: dalISO, p_al: alISO })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const j: any = d || {}

  const k: any = j.kpi || {}
  return NextResponse.json({
    kpi: { totale: r2(n(k.totale)), rimesso: r2(n(k.rimesso)), inAttesa: r2(n(k.inAttesa)), esposizione: r2(n(k.esposizione)) },
    perCorriere: (j.perCorriere || []).map((c: any) => ({ corriere: c.corriere, importo: r2(n(c.importo)) })).sort((a: any, b: any) => b.importo - a.importo),
    aging: (j.aging || []).map((a: any) => ({ fascia: a.fascia, importo: r2(n(a.importo)) })),
    perCliente: (j.perCliente || []).map((c: any) => ({ nome: c.nome, num: n(c.num), totale: r2(n(c.totale)), attesa: r2(n(c.attesa)) }))
      .sort((a: any, b: any) => b.totale - a.totale).slice(0, 20),
    vecchi: (j.vecchi || []).map((v: any) => ({ ldv: v.ldv, cliente: v.cliente, importo: r2(n(v.importo)), giorni: n(v.giorni) }))
      .sort((a: any, b: any) => b.giorni - a.giorni).slice(0, 20),
  })
}
