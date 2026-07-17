import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { fetchAll } from '@/lib/fetch-all'

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
  const sp = await fetchAll(() => admin.from('spedizioni')
    .select('stato,costo_spedizione,peso_reale,contrassegno,assicurazione,servizi_accessori,updated_at,created_at,corrieri(nome_contratto,tipo)')
    .in('master_id', sub.length ? sub : [M]).gte('created_at', dalISO).lte('created_at', alISO)
    .order('created_at', { ascending: false }))

  const CONSEGNATA = 'consegnata'
  const agg = new Map<string, any>()
  let totSped = 0, totConsegnate = 0, totResi = 0, totCosto = 0, totPeso = 0, totTransito = 0, nTransito = 0
  for (const s of (sp || [])) {
    if ((s as any).stato === 'annullata') continue
    const corr = (s as any).corrieri?.nome_contratto || '—'
    const costo = n((s as any).costo_spedizione), peso = n((s as any).peso_reale)
    const consegnata = (s as any).stato === CONSEGNATA
    const reso = (s as any).stato === 'reso_mittente'
    // transito ≈ created_at → updated_at per le consegnate (approssimazione)
    let transito = 0
    if (consegnata && (s as any).updated_at && (s as any).created_at) {
      transito = Math.max(0, (Date.parse((s as any).updated_at) - Date.parse((s as any).created_at)) / 86400000)
      if (transito > 0 && transito < 60) { totTransito += transito; nTransito++ }
    }
    const cur = agg.get(corr) || { sped: 0, consegnate: 0, resi: 0, costo: 0, peso: 0, transito: 0, nTransito: 0, assic: 0, cod: 0, serv: 0 }
    cur.sped++; if (consegnata) cur.consegnate++; if (reso) cur.resi++
    cur.costo += costo; cur.peso += peso
    if (transito > 0 && transito < 60) { cur.transito += transito; cur.nTransito++ }
    cur.assic += n((s as any).assicurazione); cur.cod += n((s as any).contrassegno)
    const serv = Array.isArray((s as any).servizi_accessori) ? (s as any).servizi_accessori.reduce((a: number, x: any) => a + n(x?.importo), 0) : 0
    cur.serv += serv
    agg.set(corr, cur)
    totSped++; if (consegnata) totConsegnate++; if (reso) totResi++; totCosto += costo; totPeso += peso
  }

  const perCorriere = Array.from(agg.entries()).map(([corriere, v]) => ({
    corriere, spedizioni: v.sped, costo: r2(v.costo), costoMedio: v.sped ? r2(v.costo / v.sped) : 0,
    costoKg: v.peso ? r2(v.costo / v.peso) : 0, consegna: v.sped ? r2((v.consegnate / v.sped) * 100) : 0,
    resi: v.sped ? r2((v.resi / v.sped) * 100) : 0, transito: v.nTransito ? r2(v.transito / v.nTransito) : 0,
    pesoCarb: r2(v.costo), assicurazione: r2(v.assic), contrassegno: r2(v.cod), servizi: r2(v.serv),
  })).sort((a, b) => b.spedizioni - a.spedizioni)

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
