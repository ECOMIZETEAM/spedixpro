import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  // Il portale di destinazione va deciso PRIMA di chiudere la sessione, altrimenti l'utente non
  // e' piu' leggibile. Il cliente che usciva finiva sul Control Center master: portale sbagliato,
  // e per rientrare doveva scrivere /cliente a mano.
  let versoCliente = false
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: u } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).maybeSingle()
      versoCliente = !!u?.cliente_id
    }
  } catch {}
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL(versoCliente ? '/cliente' : '/', req.url))
}
