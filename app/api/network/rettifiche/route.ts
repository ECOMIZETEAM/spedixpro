import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Decisione del master ricevente su una rettifica di catena: 'propagata' o 'assorbita'.
// La riga appartiene al master PADRE -> update via admin; autorizzazione = target_master_id mio.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const { rettifica_id, decisione } = body
  if (!rettifica_id || !['propagata', 'assorbita', null].includes(decisione)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }
  const adminDb = createAdminSupabase()
  const { data: r } = await adminDb.from('rettifiche')
    .select('id,target_master_id').eq('id', rettifica_id).maybeSingle()
  if (!r || r.target_master_id !== utente.master_id) {
    return NextResponse.json({ error: 'Rettifica non trovata' }, { status: 404 })
  }
  const { error } = await adminDb.from('rettifiche')
    .update({ propagazione: decisione }).eq('id', rettifica_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
