import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { mandaPush } from '@/lib/notifiche-push'

// UNA NOTIFICA DI PROVA ai propri dispositivi, appena attivate: chi la attiva vede subito che funziona.
export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const esito = await mandaPush(createAdminSupabase(), user.id, {
    titolo: 'Notifiche attive', testo: 'Da qui arriveranno promemoria, inviti e il riepilogo del mattino.',
    link: u?.cliente_id ? '/cliente/calendario' : '/dashboard/calendario', chiave: 'prova',
  })
  return NextResponse.json(esito)
}
