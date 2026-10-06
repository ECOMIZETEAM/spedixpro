import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { calderoneCache, conCache } from '@/lib/cache-memoria'

// STATISTICHE — PROFITTO = IL CALDERONE del master, scomposto PER-VOCE, PER-CONTRATTO e PER-CLIENTE.
// Stessa identica base del "Guadagno Totale" della dashboard (/api/reports/guadagno-totale), ma qui
// spaccato per cliente e per contratto: spedizioni (DATA CREAZIONE, come il Report Spedizioni) +
// rettifiche/rimborsi/resi/giacenze/commissioni/accessori/logistica (DATA MOVIMENTO, chain-aware) +
// canone (abbonamenti_pagamenti) + consumabili. Pass-through 'ricarica' e 'contrassegno' ESCLUSI.
//
// Garanzia verificata sui dati veri: Somma(perContratto) == Somma(perCliente) == totale == Guadagno
// Totale della dashboard, al centesimo (RPC calderone_dettaglio_v2). La vecchia pagina sommava solo 5
// tipi e contava le spedizioni per data movimento: non combaciava mai e a ottobre perdeva i consumabili.
// NODI-CODICE (grafo corrieri_condivisi): calderone_dettaglio_v2 azzera il business d'ingrosso (guardia
// "cm/pc null => azzera", perimetro ALBERO) -> si somma guadagno_ingrosso_adj_v1 al TOTALE e alla voce
// Spedizioni per ri-combaciare con la dashboard. perContratto/perCliente NON lo includono (l'ingrosso non
// e' una riga-contratto reale): per i nodi-codice il breakdown somma meno del totale, di proposito.
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
  let j: any, nSped: number
  try {
    [j, nSped] = await Promise.all([
      calderoneCache(admin, M, dalISO, alISO),
      conCache(`numsp:${M}:${dalISO}:${alISO}`, 60_000, async () => {
        const { data, error } = await admin.rpc('guadagno_num_spedizioni_v1', { p_master: M, p_dal: dalISO, p_al: alISO })
        if (error) throw new Error(error.message)
        return n(data)
      }),
    ])
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }

  // Adj nodi-codice (stessa funzione del Guadagno Totale) per far combaciare questa pagina con la dashboard.
  // Resiliente: se la funzione erra/manca, adj=0 e la pagina non cade.
  let adjRic = 0, adjCos = 0
  try {
    const { data: adj, error } = await admin.rpc('guadagno_ingrosso_adj_v1', { p_master: M, p_dal: dalISO, p_al: alISO })
    if (!error && adj) { const a: any = Array.isArray(adj) ? adj[0] : adj; adjRic = n(a?.ricavi_adj); adjCos = n(a?.costi_adj) }
  } catch { /* adj resta 0 */ }

  const ric = r2(n(j.totale?.ricavi) + adjRic), cos = r2(n(j.totale?.costi) + adjCos), gua = r2(ric - cos)

  // L'adj entra nella voce "Spedizioni" cosi' Somma(perVoce) == totale anche per i nodi-codice.
  const perTipoRaw = (j.perTipo || []).map((v: any) => ({ tipo: v.tipo, ricavi: n(v.ricavi), costi: n(v.costi) }))
  if (adjRic !== 0 || adjCos !== 0) {
    const sp = perTipoRaw.find((v: any) => v.tipo === 'spedizione')
    if (sp) { sp.ricavi += adjRic; sp.costi += adjCos }
    else perTipoRaw.push({ tipo: 'spedizione', ricavi: adjRic, costi: adjCos })
  }
  const perVoce = perTipoRaw
    .map((v: any) => ({ tipo: v.tipo, label: ETICHETTE[v.tipo] || v.tipo, ricavi: r2(v.ricavi), costi: r2(v.costi), guadagno: r2(v.ricavi - v.costi) }))
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
