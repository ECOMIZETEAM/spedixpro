import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds, contrattiPossedutiNomi } from '@/lib/rete-masters'

// STATISTICHE — CORRIERI (sola lettura). Efficienza costi e SLA su TUTTO il sottoalbero del master.
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
  // VISIBILITÀ PER CONTRATTO: le statistiche di rete contano SOLO i contratti che il master possiede
  // (non i privati dei sub). p_contratti null se il master non ha contratti → nessun filtro.
  const nomiPosseduti = await contrattiPossedutiNomi(admin, M)
  // Costo REALE dai movimenti (target = questo master), non dalla colonna nominale costo_spedizione:
  // cosi' le RIPESATURE e le rettifiche entrano nel costo del corriere. Aggregazione in SQL (stat_corrieri_v2)
  // — prima si caricavano in memoria tutte le spedizioni del sottoalbero. SECURITY DEFINER: chiamabile solo
  // via service_role (revoke da anon/authenticated).
  const { data: rows, error } = await admin.rpc('stat_corrieri_v2', {
    p_sub: sub.length ? sub : [M], p_master: M, p_dal: dalISO, p_al: alISO,
    p_contratti: nomiPosseduti.length ? nomiPosseduti : null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let totSped = 0, totConsegnate = 0, totResi = 0, totCosto = 0, totPeso = 0, totTransito = 0, nTransito = 0
  const perCorriere = (rows || []).map((v: any) => {
    const sped = n(v.spedizioni), costo = n(v.costo), peso = n(v.peso)
    const consegnate = n(v.consegnate), resi = n(v.resi)
    const transitoSum = n(v.transito_sum), transitoN = n(v.transito_n)
    totSped += sped; totConsegnate += consegnate; totResi += resi
    totCosto += costo; totPeso += peso; totTransito += transitoSum; nTransito += transitoN
    return {
      corriere: v.corriere || '—', spedizioni: sped, costo: r2(costo), costoMedio: sped ? r2(costo / sped) : 0,
      costoKg: peso ? r2(costo / peso) : 0, consegna: sped ? r2((consegnate / sped) * 100) : 0,
      resi: sped ? r2((resi / sped) * 100) : 0, transito: transitoN ? r2(transitoSum / transitoN) : 0,
      pesoCarb: r2(costo), assicurazione: r2(n(v.assic)), contrassegno: r2(n(v.cod)), servizi: r2(n(v.serv)),
    }
  }).sort((a: any, b: any) => b.spedizioni - a.spedizioni)

  return NextResponse.json({
    kpi: {
      tassoConsegna: totSped ? r2((totConsegnate / totSped) * 100) : 0,
      transitoMedio: nTransito ? r2(totTransito / nTransito) : 0,
      costoKg: totPeso ? r2(totCosto / totPeso) : 0,
      costoMedio: totSped ? r2(totCosto / totSped) : 0,
    },
    perCorriere,
  })
}
