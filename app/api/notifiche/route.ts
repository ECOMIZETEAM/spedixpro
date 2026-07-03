import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()

  const body = await req.json()
  const { oggetto, messaggio, gruppi } = body
  if (!oggetto || !oggetto.trim()) return NextResponse.json({ error: 'Oggetto obbligatorio' }, { status: 400 })
  if (!Array.isArray(gruppi) || !gruppi.length) return NextResponse.json({ error: 'Seleziona almeno un gruppo di utenti' }, { status: 400 })

  const { data, error } = await supabase.from('notifiche').insert({
    master_id: utente?.master_id,
    oggetto: oggetto.trim(),
    messaggio: messaggio || '',
    gruppi,
    created_by: user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, notifica: data })
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const { data } = await supabase.from('notifiche')
    .select('*')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
    .limit(100)
  return NextResponse.json(data || [])
}