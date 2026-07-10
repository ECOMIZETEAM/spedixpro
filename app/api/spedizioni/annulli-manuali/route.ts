import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Coda annulli MANUALI (Spedisci): le vede SOLO il detentore del contratto
// (annullamento_owner_id = suo master). Le richiede via assistenza WhatsApp e poi conferma.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json([])

  const admin = createAdminSupabase()
  const { data } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,dest_nome,dest_citta,dest_provincia,created_at,annullamento_richiesto_at,corrieri(nome_contratto)')
    .eq('stato', 'annullamento_manuale')
    .eq('annullamento_owner_id', utente.master_id)
    .order('annullamento_richiesto_at', { ascending: true })
    .limit(500)
  return NextResponse.json(data || [])
}
