import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Restituisce le notifiche destinate al gruppo dell'utente corrente
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()

  // mappa ruolo -> etichetta gruppo usata nell'invio
  const mappa: Record<string,string> = { cliente: 'Cliente', admin: 'Amministratore', master: 'Amministratore', operatore: 'Operatore', agente: 'Agente' }
  const gruppo = mappa[(utente?.ruolo || '').toLowerCase()] || 'Cliente'

  const { data } = await supabase.from('notifiche')
    .select('*')
    .eq('master_id', utente?.master_id)
    .contains('gruppi', [gruppo])
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data || [])
}