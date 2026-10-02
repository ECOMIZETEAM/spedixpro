import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// STATISTICHE — PROFITTO = IL CALDERONE del master, scomposto PER-VOCE, PER-CONTRATTO e PER-CLIENTE.
// Stessa identica base del "Guadagno Totale" della dashboard (/api/reports/guadagno-totale), ma qui
// spaccato per cliente e per contratto: spedizioni (DATA CREAZIONE, come il Report Spedizioni) +
// rettifiche/rimborsi/resi/giacenze/commissioni/accessori/logistica (DATA MOVIMENTO, chain-aware) +
// canone (abbonamenti_pagamenti) + consumabili. Pass-through 'ricarica' e 'contrassegno' ESCLUSI.
//
// Garanzia verificata sui dati veri: Somma(perContratto) == Somma(perCliente) == totale == Guadagno
// Totale della dashboard, al centesimo (RPC calderone_dettaglio_v2). La vecchia pagina sommava solo 5
// tipi e contava le spedizioni per data movimento: non combaciava mai e a ottobre perdeva i consumabili.
const r2 = (x: number) => Math.round(x * 100) / 100
const n = (x: any) => Number(x || 0)
const marg = (ric: number, cos: number) => (ric > 0 ? r2(((ric - cos) / ric) * 100) : 0)

const ETICHETTE: Record<string, string> = {
  spedizione: 'Spedizioni', rettifica: 'Rettifiche / ripesature', reso: 'Resi', giacenza: 'Giacenze',
  rimborso: 'Rimborsi', commissione: 'Commissioni', accessorio: 'Accessori', logistica: 'Logistica',
  consumabile: 'Consumabili', canone: 'Canone abbonamento',
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) {
    return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })
  }

  const dalISO = req.nextUrl.searchParams.get('dal')
    ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00.000Z').toISOString()
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al')
    ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59.999Z').toISOString()
    : new Date().toISOString()

  const admin = createAdminSupabase()
  const [cal, cnt] = await Promise.all([
    admin.rpc('calderone_dettaglio_v2', { p_master: M, p_dal: dalISO, p_al: alISO }),
    admin.rpc('guadagno_num_spedizioni_v1', { p_master: M, p_dal: dalISO, p_al: alISO }),
  ])
  if (cal.error) return NextResponse.json({ error: cal.error.message }, { status: 500 })
  const j: any = cal.data || {}
  const nSped = n(cnt.data)

  const ric = r2(n(j.totale?.ricavi)), cos = r2(n(j.totale?.costi)), gua = r2(ric - cos)

  const perVoce = (j.perTipo || [])
    .map((v: any) => ({ tipo: v.tipo, label: ETICHETTE[v.tipo] || v.tipo, ricavi: r2(n(v.ricavi)), costi: r2(n(v.costi)), guadagno: r2(n(v.ricavi) - n(v.costi)) }))
    .filter((v: any) => v.ricavi !== 0 || v.costi !== 0)
    .sort((a: any, b: any) => b.guadagno - a.guadagno)

  const perContratto = (j.perContratto || []).map((c: any) => ({
    contratto: c.contratto, spedizioni: n(c.spedizioni), ricavi: r2(n(c.ricavi)), costi: r2(n(c.costi)),
    guadagno: r2(n(c.guadagno)), margine: marg(n(c.ricavi), n(c.costi)),
  }))
  const perCliente = (j.perCliente || []).map((c: any) => ({
    nome: c.nome, spedizioni: n(c.spedizioni), ricavi: r2(n(c.ricavi)), costi: r2(n(c.costi)),
    guadagno: r2(n(c.guadagno)), margine: marg(n(c.ricavi), n(c.costi)),
  }))

  return NextResponse.json({
    totale: { ricavi: ric, costi: cos, guadagno: gua, margine: marg(ric, cos) },
    spedizioni: nSped,
    guadagnoMedio: nSped > 0 ? r2(gua / nSped) : 0,
    perVoce, perContratto, perCliente,
  })
}
