import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Forza la propagazione di TUTTE le zone di un corriere ai sotto-master (fallback manuale;
// le modifiche singole ai CAP propagano già in automatico). body: { corriereId }
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { corriereId } = await req.json()
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { sincronizzaZonaAiDiscendenti } = await import('@/lib/propaga-zona')

  const { data: zone } = await admin.from('zone').select('id').eq('corriere_id', corriereId)
  let sincronizzate = 0
  for (const z of (zone || [])) {
    try { await sincronizzaZonaAiDiscendenti(admin, (z as any).id); sincronizzate++ } catch (e) { console.error('sync zona', (z as any).id, e) }
  }
  return NextResponse.json({ ok: true, zone_sincronizzate: sincronizzate })
}
