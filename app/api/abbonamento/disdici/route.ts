import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Disdetta abbonamento: il master torna BLOCCATO (nessun piano) e non può usare
// la piattaforma finché non ne seleziona uno nuovo. Nessun rimborso.
export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  await admin.from('masters').update({
    abbonamento_piano: null, abbonamento_limite: null, abbonamento_prezzo: null, abbonamento_mese: null,
  }).eq('id', utente.master_id)
  return NextResponse.json({ success: true })
}
