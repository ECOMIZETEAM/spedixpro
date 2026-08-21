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

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 20))

  // Anti-join server-side (RPC): raggiunge TUTTE le non-controllate, non solo le recenti.
  const { data: righe } = await admin.rpc('prossime_ripesature', { lim: limit })

  // Arretrato (solo per display): consegnate PDB - gia' controllate.
  let restanti = 0
  const { data: pdb } = await admin.from('corrieri').select('id')
    .eq('nome_contratto', 'Poste Delivery Business S').eq('tipo', 'spediamopro')
  const pdbIds = (pdb || []).map((c: any) => c.id)
  if (pdbIds.length) {
    const { count: consegnate } = await admin.from('spedizioni').select('*', { count: 'exact', head: true })
      .in('corriere_id', pdbIds).eq('stato', 'consegnata').not('tracking_number', 'is', null)
    const { count: controllate } = await admin.from('ripesature_check').select('*', { count: 'exact', head: true })
    restanti = Math.max(0, (consegnate || 0) - (controllate || 0))
  }

  return NextResponse.json({
    righe: (righe || []).map((r: any) => ({ spedizione_id: r.spedizione_id, ldv: r.ldv })),
    restanti,
  })
}
