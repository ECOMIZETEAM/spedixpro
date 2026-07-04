import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaPrezzoListino, zonaDaProvincia } from '@/lib/pricing'

// DEBUG temporaneo: GET /api/debug-catena?listino=<id>&provincia=RM&peso=1
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const listinoId = p.get('listino') || ''
  const provincia = p.get('provincia') || 'RM'
  const peso = parseFloat(p.get('peso') || '1')

  const out: any = { listinoId, provincia, peso, zonaNome: zonaDaProvincia(provincia) }

  const { data: listino, error: e1 } = await supabase
    .from('listini_clienti').select('id,nome,fattore_volume').eq('id', listinoId).single()
  out.listino = listino || null
  out.erroreListino = e1?.message || null

  const { data: fasce, error: e2 } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(id,nome), corrieri(id,tipo,nome_contratto,settings)')
    .eq('listino_id', listinoId)
    .order('peso_max', { ascending: true })
  out.erroreFasce = e2?.message || null
  out.nFasce = fasce?.length || 0
  out.zoneDistinte = Array.from(new Set((fasce||[]).map((f:any)=>(f.zone as any)?.nome ?? 'NULL')))
  out.corriereNullSuFasce = (fasce||[]).filter((f:any)=>!(f.corrieri as any)?.id).length
  out.esempioFascia = (fasce||[])[0] || null

  const ris = await calcolaPrezzoListino(supabase, { listinoId, provincia, packages: [{ weight: peso }] })
  out.risultatoFinale = ris

  return NextResponse.json(out)
}
