import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// LA RISPOSTA A UN INVITO (fase 2): «partecipo» o «non partecipo». Solo il proprio invito (utente_id = sessione).
// Dopo «non partecipo» la voce resta nel calendario in grigio (per poterci ripensare) ma non arrivano più avvisi, né
// nella campanella né per email, e non esce nel link per Google e iPhone.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const eventoId = String(b?.evento_id || ''), risposta = String(b?.risposta || '')
  if (!/^[0-9a-f-]{36}$/i.test(eventoId) || !['accettato', 'rifiutato'].includes(risposta)) return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data, error } = await admin.from('calendario_inviti')
    .update({ stato: risposta, risposto_il: new Date().toISOString() })
    .eq('evento_id', eventoId).eq('utente_id', user.id).is('eliminato_il', null)
    .select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Risposta non salvata: ' + error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Invito non trovato' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
