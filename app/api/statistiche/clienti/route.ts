import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// STATISTICHE — CLIENTI del master (sola lettura). Solo i PROPRI clienti diretti (analisi per cliente)
// + i sotto-master diretti come entità. Fatturato/profitto = margine del master su ciascuno.
//
// Aggregazione nel DB (RPC clienti_dettaglio_v1): per cliente fatturato/costo/nº spedizioni/resi/COD/
// ultima + fatturato del periodo precedente, più i sotto-master come entità e i clienti "a rischio"
// (fatturavano prima, ora no). Prima si scaricavano in memoria TUTTI i movimenti (correnti + precedenti)
// e le spedizioni dei clienti, mille per round-trip: decine di secondi sul super-master. La logica del
// margine è quella del Report Guadagno/Profitto; l'aritmetica finale (profitto, margini, medie, top-12,
// crescita, rischio) resta qui.
const TIPI = ['spedizione', 'rimborso', 'rettifica', 'reso', 'giacenza']
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
  const durata = Date.parse(alISO) - Date.parse(dalISO)
  const prevDal = new Date(Date.parse(dalISO) - durata).toISOString()
  const prevAl = dalISO

  const admin = createAdminSupabase()
  const { data: d, error } = await admin.rpc('clienti_dettaglio_v1', {
    p_master: M, p_dal: dalISO, p_al: alISO, p_prev_dal: prevDal, p_prev_al: prevAl, p_tipi: TIPI,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const j: any = d || {}

  // Clienti diretti: profitto/margine per riga come prima.
  const righe = (j.clienti || []).map((c: any) => {
    const fatt = n(c.fatturato), cost = n(c.costo)
    return {
      nome: c.nome || 'Cliente', spedizioni: n(c.spedizioni), fatturato: r2(fatt), costo: r2(cost),
      profitto: r2(fatt - cost), margine: fatt > 0 ? r2(((fatt - cost) / fatt) * 100) : 0,
      resi: n(c.resi), contrassegno: r2(n(c.contrassegno)), ultima: c.ultima || '',
      _precedente: n(c.precedente),   // solo per crescita, tolto dall'output
    }
  })
  // crescita (variazione positiva rispetto al periodo precedente) — prima di aggiungere i sotto-master.
  const crescita = righe
    .map((r: any) => ({ nome: r.nome, precedente: r2(r._precedente), attuale: r.fatturato, variazione: r2(r.fatturato - r._precedente) }))
    .filter((c: any) => c.variazione > 0).sort((a: any, b: any) => b.variazione - a.variazione).slice(0, 10)
  for (const r of righe) delete r._precedente

  // Sotto-master diretti come entità (fatturato = ri-addebiti, profitto = fatturato).
  for (const s of (j.sub || [])) righe.push({ nome: s.nome, spedizioni: 0, fatturato: r2(n(s.fatturato)), costo: 0, profitto: r2(n(s.fatturato)), margine: 100, resi: 0, contrassegno: 0, ultima: '' })

  const clientiAttivi = righe.length
  const fatturatoTot = r2(righe.reduce((a: number, r: any) => a + r.fatturato, 0))
  const profittoTot = r2(righe.reduce((a: number, r: any) => a + r.profitto, 0))
  const fatturatoMedio = clientiAttivi ? r2(fatturatoTot / clientiAttivi) : 0
  const profittoMedio = clientiAttivi ? r2(profittoTot / clientiAttivi) : 0

  const rischio = (j.rischio || []).map((r: any) => ({ nome: r.nome || 'Cliente', fatturatoPrec: r2(n(r.fatturatoPrec)) }))
    .sort((a: any, b: any) => b.fatturatoPrec - a.fatturatoPrec).slice(0, 10)

  return NextResponse.json({
    kpi: { clientiAttivi, fatturatoMedio, profittoMedio, valoreDaFatturare: fatturatoTot },
    righe: righe.sort((a: any, b: any) => b.fatturato - a.fatturato),
    topFatturato: [...righe].sort((a: any, b: any) => b.fatturato - a.fatturato).slice(0, 12),
    topProfitto: [...righe].sort((a: any, b: any) => b.profitto - a.profitto).slice(0, 12),
    crescita, rischio,
  })
}
