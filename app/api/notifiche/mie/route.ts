import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Restituisce le notifiche destinate al gruppo dell'utente corrente
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()

  // mappa ruolo -> etichetta gruppo usata nell'invio
  const mappa: Record<string,string> = { cliente: 'Cliente', admin: 'Amministratore', master: 'Amministratore', operatore: 'Operatore', agente: 'Agente' }
  const gruppo = mappa[(utente?.ruolo || '').toLowerCase()] || 'Cliente'

  let q = supabase.from('notifiche').select('*').eq('master_id', utente?.master_id)
  if (utente?.cliente_id) {
    // Cliente: i broadcast del suo gruppo (cliente_id vuoto) PIÙ le notifiche mirate a lui.
    // La policy RLS garantisce comunque che non veda quelle mirate ad altri clienti.
    q = q.or(`cliente_id.eq.${utente.cliente_id},and(cliente_id.is.null,gruppi.cs.{${gruppo}})`)
  } else {
    // Master/operatore/agente: solo i broadcast del gruppo (le mirate sono roba da clienti).
    q = q.is('cliente_id', null).contains('gruppi', [gruppo])
  }
  const { data } = await q.order('created_at', { ascending: false }).limit(20)

  return NextResponse.json(data || [])
}