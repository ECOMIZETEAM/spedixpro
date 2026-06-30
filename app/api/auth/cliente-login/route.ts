import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return NextResponse.json({ error: 'Email o password non corretti' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo,cliente_id').eq('id', data.user.id).single()
  if (!utente?.cliente_id) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Accesso non autorizzato' }, { status: 403 })
  }
  return NextResponse.json({ ok: true })
}
