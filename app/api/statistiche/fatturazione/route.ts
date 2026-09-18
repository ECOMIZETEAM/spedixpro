import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// STATISTICHE — FATTURAZIONE (sola lettura). Fatturato del master ai propri clienti/sotto-master
// diretti, con quota "da fatturare" (clienti a fattura mensile).
//
// Aggregazione nel DB (RPC fatturazione_dettaglio_v1): per cliente il fatturato + flag fattura mensile,
// i sotto-master come entità (self + ri-addebiti), e la serie per mese. Prima si scaricavano in memoria
// TUTTI i movimenti del periodo (default: l'anno) mille per round-trip: lento sul super-master. Logica
// del ricavo = Report Guadagno/Profitto; l'aritmetica finale (totali, da fatturare) resta qui.
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

  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00Z').toISOString() : new Date(new Date().getFullYear(), 0, 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59Z').toISOString() : new Date().toISOString()

  const admin = createAdminSupabase()
  const { data: d, error } = await admin.rpc('fatturazione_dettaglio_v1', { p_master: M, p_dal: dalISO, p_al: alISO, p_tipi: TIPI })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const j: any = d || {}

  const righe = (j.clienti || []).map((c: any) => ({
    nome: c.nome || 'Cliente', fatturato: r2(n(c.fatturato)), tipo: c.mensile ? 'Fattura mensile' : 'Credito',
  }))
  for (const s of (j.sub || [])) righe.push({ nome: s.nome, fatturato: r2(n(s.fatturato)), tipo: 'Rete' })
  righe.sort((a: any, b: any) => b.fatturato - a.fatturato)

  const fatturatoTot = r2(righe.reduce((a: number, r: any) => a + r.fatturato, 0))
  const daFatturare = r2((j.clienti || []).filter((c: any) => c.mensile).reduce((a: number, c: any) => a + n(c.fatturato), 0))

  return NextResponse.json({
    kpi: { fatturatoTot, daFatturare, clienti: righe.length },
    serieMese: (j.serieMese || []).map((s: any) => ({ mese: s.mese, fatturato: r2(n(s.fatturato)) })),
    righe,
  })
}
