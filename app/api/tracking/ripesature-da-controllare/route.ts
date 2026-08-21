import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester } from '@/lib/ripesature-harvester'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// LDV consegnate PDB non ancora controllate (le piu' recenti prima). Le usa lo script locale per
// sapere cosa interrogare su OneTracking. L'anti-join su ripesature_check fa avanzare il giro da solo.
export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 40))
  const { data: pdb } = await admin.from('corrieri').select('id')
    .eq('nome_contratto', 'Poste Delivery Business S').eq('tipo', 'spediamopro')
  const pdbIds = (pdb || []).map((c: any) => c.id)
  if (!pdbIds.length) return NextResponse.json({ righe: [], restanti: 0 })

  const { data: cand } = await admin.from('spedizioni').select('id,tracking_number')
    .in('corriere_id', pdbIds).eq('stato', 'consegnata').not('tracking_number', 'is', null)
    .order('created_at', { ascending: false }).limit(500)
  const ids = (cand || []).map((c: any) => c.id)
  const { data: gia } = ids.length
    ? await admin.from('ripesature_check').select('spedizione_id').in('spedizione_id', ids)
    : { data: [] as any[] }
  const fatti = new Set((gia || []).map((g: any) => g.spedizione_id))
  const daFare = (cand || []).filter((c: any) => !fatti.has(c.id))

  return NextResponse.json({
    righe: daFare.slice(0, limit).map((c: any) => ({ spedizione_id: c.id, ldv: c.tracking_number })),
    restanti: daFare.length,
  })
}
