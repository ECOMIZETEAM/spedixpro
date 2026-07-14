import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ permessi: {} })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ permessi: {}, ruolo: (utente?.ruolo || '') })
  const { data } = await supabase.from('master_permessi').select('permessi').eq('master_id', utente.master_id).maybeSingle()
  return NextResponse.json({ permessi: data?.permessi || {}, ruolo: (utente.ruolo || '').toLowerCase() })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const permessi = body?.permessi
  if (!permessi || typeof permessi !== 'object') return NextResponse.json({ error: 'Permessi non validi' }, { status: 400 })
  const { error } = await supabase.from('master_permessi').upsert({
    master_id: utente.master_id,
    permessi,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'master_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}