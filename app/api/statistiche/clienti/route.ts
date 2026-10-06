import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { calderoneCache } from '@/lib/cache-memoria'

// STATISTICHE — CLIENTI: analisi per cliente/entità sul CALDERONE (stessa base verificata della pagina
// Report Guadagno). Il guadagno per cliente = incassato − speso, con la catena corretta: NON più il
// vecchio bug che contava il fatturato a valle dei sotto-master come profitto 100% (gonfiava 12-18×).
// Crescita/rischio dal confronto col periodo precedente di pari durata.
const r2 = (x: number) => Math.round(x * 100) / 100
const n = (x: any) => Number(x || 0)
const marg = (ric: number, cos: number) => (ric > 0 ? r2(((ric - cos) / ric) * 100) : 0)
// Voci sintetiche del calderone che NON sono clienti: fuori dall'analisi clienti.
const NON_CLIENTI = new Set(['Consumabili', 'Canone'])

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const dalD = req.nextUrl.searchParams.get('dal') ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00.000Z') : new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1))
  const alD = req.nextUrl.searchParams.get('al') ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59.999Z') : new Date()
  // Periodo precedente di pari durata, subito prima.
  const durata = alD.getTime() - dalD.getTime()
  const prevAl = new Date(dalD.getTime() - 1)
  const prevDal = new Date(dalD.getTime() - 1 - durata)

  const admin = createAdminSupabase()
  let curData: any, prevData: any
  try {
    [curData, prevData] = await Promise.all([
      calderoneCache(admin, M, dalD.toISOString(), alD.toISOString()),
      calderoneCache(admin, M, prevDal.toISOString(), prevAl.toISOString()),
    ])
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }

  const clientiCur = (curData?.perCliente || []).filter((c: any) => !NON_CLIENTI.has(c.nome))
  const prevMap = new Map<string, number>()
  for (const c of (prevData?.perCliente || [])) if (!NON_CLIENTI.has(c.nome)) prevMap.set(c.nome, n(c.ricavi))

  // CORREZIONE NODI-CODICE: la vendita ingrosso (ponte/acquirente) e' azzerata dal calderone -> per un ponte
  // la pagina Clienti risultava quasi vuota. Compare come riga aggregata "Fatturato ingrosso" (e' un
  // conto-ledger, non un cliente reale a fattura). Resiliente; vuoto per i master non-codice.
  let adjRic = 0, adjCos = 0
  try {
    const { data: adj } = await admin.rpc('guadagno_ingrosso_adj_v1', { p_master: M, p_dal: dalD.toISOString(), p_al: alD.toISOString() })
    const a: any = Array.isArray(adj) ? adj?.[0] : adj
    adjRic = r2(n(a?.ricavi_adj)); adjCos = r2(n(a?.costi_adj))
  } catch { /* 0 */ }

  const righe = clientiCur.map((c: any) => ({
    nome: c.nome, spedizioni: n(c.spedizioni), fatturato: r2(n(c.ricavi)), costo: r2(n(c.costi)),
    profitto: r2(n(c.guadagno)), margine: marg(n(c.ricavi), n(c.costi)),
  }))
  if (adjRic !== 0 || adjCos !== 0) righe.push({ nome: 'Fatturato ingrosso', spedizioni: 0, fatturato: adjRic, costo: adjCos, profitto: r2(adjRic - adjCos), margine: marg(adjRic, adjCos) })
  righe.sort((a: any, b: any) => b.fatturato - a.fatturato)

  const nCli = righe.length
  const totRic = r2(righe.reduce((s: number, r: any) => s + r.fatturato, 0))
  const totGua = r2(righe.reduce((s: number, r: any) => s + r.profitto, 0))

  const crescita = righe
    .map((r: any) => ({ nome: r.nome, attuale: r.fatturato, precedente: r2(prevMap.get(r.nome) || 0), variazione: r2(r.fatturato - (prevMap.get(r.nome) || 0)) }))
    .filter((c: any) => c.precedente > 0 && c.variazione > 0)
    .sort((a: any, b: any) => b.variazione - a.variazione).slice(0, 12)

  const nomiCur = new Set(righe.map((r: any) => r.nome))
  const rischio = Array.from(prevMap.entries())
    .filter(([nome, ric]) => ric > 0 && !nomiCur.has(nome))
    .map(([nome, ric]) => ({ nome, fatturatoPrec: r2(ric) }))
    .sort((a, b) => b.fatturatoPrec - a.fatturatoPrec).slice(0, 12)

  return NextResponse.json({
    kpi: {
      clientiAttivi: nCli,
      fatturatoMedio: nCli > 0 ? r2(totRic / nCli) : 0,
      profittoMedio: nCli > 0 ? r2(totGua / nCli) : 0,
      valoreDaFatturare: totRic,
    },
    topFatturato: [...righe].sort((a: any, b: any) => b.fatturato - a.fatturato).slice(0, 12).map((r: any) => ({ nome: r.nome, fatturato: r.fatturato })),
    topProfitto: [...righe].sort((a: any, b: any) => b.profitto - a.profitto).slice(0, 12).map((r: any) => ({ nome: r.nome, profitto: r.profitto })),
    righe, crescita, rischio,
  })
}
