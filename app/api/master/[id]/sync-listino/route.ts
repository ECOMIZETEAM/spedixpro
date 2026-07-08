import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { copiaListinoAlSottoMaster } from '@/lib/copia-listino-submaster'

// Ricopia il listino assegnato dal padre nel Listino Corrieri del sotto-master.
// ?force=1 sovrascrive (risincronizza) anche se il sotto-master ha gia' delle fasce.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: sub } = await admin.from('masters').select('id,parent_master_id').eq('id', id).single()
  if (!sub || sub.parent_master_id !== utente.master_id) return NextResponse.json({ error: 'Sotto-master non trovato o non autorizzato' }, { status: 403 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const res = await copiaListinoAlSottoMaster(admin, id, { force })
  return NextResponse.json(res)
}
