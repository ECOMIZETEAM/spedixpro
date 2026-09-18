import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// STATISTICHE — PROFITTO del master (sola lettura). Scope "le solite": solo i PROPRI clienti e i
// PROPRI sotto-master diretti (+ cascata per il volume). Il profitto è il MARGINE del master:
//   fatturato = quello che ha addebitato ai clienti diretti + sotto-master diretti
//   costo     = quello che ha pagato lui (verso il livello superiore / corriere)
//   profitto  = fatturato - costo
// Include spedizioni + rettifiche + RESI + GIACENZE (margine totale), coerente col Report Guadagno.
//
// Aggregazione nel DB (RPC profitto_dettaglio_v1): kpi, serie per giorno, breakdown per corriere e per
// entità (clienti + sotto-master), tutto in una passata. Prima si scaricavano in memoria TUTTI i
// movimenti del periodo, mille per round-trip (per E&A MULTIEXPRESS ~90.000 righe), più le spedizioni
// rilette a blocchi di 300 due volte: decine di secondi. La logica è identica (ricavo clienti +
// sotto-master, propria a margine 0, costo self + costo dal livello superiore) e i totali coincidono
// col Report Guadagno; l'aritmetica finale (arrotondamenti, medie, top-12, riempimento serie) resta qui.
const TIPI = ['spedizione', 'rimborso', 'rettifica', 'reso', 'giacenza']
const n = (x: any) => Number(x || 0)
const r2 = (x: number) => Math.round(x * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  // Agenti e clienti NON vedono le statistiche del master.
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) {
    return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })
  }

  const dal = (req.nextUrl.searchParams.get('dal') || '') + 'T00:00:00.000Z'
  const al = (req.nextUrl.searchParams.get('al') || req.nextUrl.searchParams.get('dal') || '') + 'T23:59:59.999Z'
  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(dal).toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(al).toISOString() : new Date().toISOString()

  const admin = createAdminSupabase()
  const { data: d, error } = await admin.rpc('profitto_dettaglio_v1', { p_master: M, p_dal: dalISO, p_al: alISO, p_tipi: TIPI })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const j: any = d || {}

  const fatturato = r2(n(j.fatturato))
  const costo = r2(n(j.costo))
  const profitto = r2(fatturato - costo)
  const nSped = n(j.spedizioni)
  const margine = fatturato > 0 ? r2((profitto / fatturato) * 100) : 0
  const costoMedio = nSped > 0 ? r2(costo / nSped) : 0
  const profittoMedio = nSped > 0 ? r2(profitto / nSped) : 0

  // Breakdown per corriere (i derivati per riga si calcolano qui, come prima).
  const perCorriere = (j.perCorriere || []).map((v: any) => {
    const f = n(v.fatturato), c = n(v.costo), sped = n(v.spedizioni)
    return {
      corriere: v.corriere || '—', spedizioni: sped, fatturato: r2(f), costo: r2(c),
      profitto: r2(f - c), margine: f > 0 ? r2(((f - c) / f) * 100) : 0,
      costoMedio: sped > 0 ? r2(c / sped) : 0,
    }
  }).sort((a: any, b: any) => b.profitto - a.profitto)

  // Top clienti + sotto-master diretti (come "clienti" del master). Ordinamenti/taglio a 12 come prima.
  const entita = (j.entita || []).map((e: any) => ({ nome: e.nome, fatturato: r2(n(e.fatturato)), profitto: r2(n(e.profitto)) }))
  const topFatturato = [...entita].sort((a: any, b: any) => b.fatturato - a.fatturato).slice(0, 12)
  const topProfitto = [...entita].sort((a: any, b: any) => b.profitto - a.profitto).slice(0, 12)

  // Serie temporale continua (0 dove non ci sono dati)
  const perGiorno = new Map<string, { fatturato: number; costo: number }>()
  for (const s of (j.serie || [])) perGiorno.set((s as any).giorno, { fatturato: n((s as any).fatturato), costo: n((s as any).costo) })
  const keys: string[] = []
  let t = Date.UTC(new Date(dalISO).getUTCFullYear(), new Date(dalISO).getUTCMonth(), new Date(dalISO).getUTCDate())
  const endT = Date.UTC(new Date(alISO).getUTCFullYear(), new Date(alISO).getUTCMonth(), new Date(alISO).getUTCDate())
  while (t <= endT) { keys.push(new Date(t).toISOString().slice(0, 10)); t += 86400000 }
  const serie = keys.map(k => {
    const v = perGiorno.get(k) || { fatturato: 0, costo: 0 }
    return { giorno: k, fatturato: r2(v.fatturato), costo: r2(v.costo), profitto: r2(v.fatturato - v.costo) }
  })

  return NextResponse.json({
    kpi: { profitto, fatturato, costo, margine, spedizioni: nSped, costoMedio, profittoMedio, costoMax: r2(n(j.costoMax)) },
    costoMaxDettaglio: { ldv: j.costoMaxLdv || '', cliente: j.costoMaxCliente || '' },
    serie, perCorriere, topFatturato, topProfitto,
  })
}
