import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Credito del MASTER (leggero): serve alla pillola in topbar, aggiornata ogni tanto. Solo staff di
// rete (master/admin/operatore): il cliente ha il suo credito nel proprio portale, l'agente non ne ha.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (utente?.ruolo || '').toLowerCase()
  if (!utente?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ mostra: false })
  }
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('credito,credito_proprio').eq('id', utente.master_id).maybeSingle()
  return NextResponse.json({
    mostra: true,
    rete: Number((m as any)?.credito || 0),
    proprio: Number((m as any)?.credito_proprio || 0),
  })
}
