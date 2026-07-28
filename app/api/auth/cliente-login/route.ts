import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  // Stessa normalizzazione dell'accesso master: spazi e maiuscole non devono bloccare nessuno.
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.warn('[LOGIN][CLIENTE][FALLITO]', { email, motivo: error.message })
    return NextResponse.json({ error: 'Email o password non corretti' }, { status: 401 })
  }
  const { data: utente } = await supabase.from('utenti').select('ruolo,cliente_id').eq('id', data.user.id).single()
  if (!utente?.cliente_id) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Accesso non autorizzato' }, { status: 403 })
  }
  return NextResponse.json({ ok: true })
}
