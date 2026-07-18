import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
async function getClienteId(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  return utente?.cliente_id || null
}
export async function GET() {
  const supabase = await createServerSupabase()
  const id = await getClienteId(supabase)
  if (!id) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: cliente } = await supabase.from('clienti').select('*').eq('id', id).single()
  return NextResponse.json(cliente || { error: 'Non trovato' })
}
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabase()
  const id = await getClienteId(supabase)
  if (!id) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  // il cliente puo aggiornare solo le proprie impostazioni (non credito, non listino, ecc.)
  const payload: any = {}
  if (body.impostazioni !== undefined) payload.impostazioni = body.impostazioni
  if (Object.keys(payload).length === 0) return NextResponse.json({ ok: true })
  const { error } = await supabase.from('clienti').update(payload).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
// La pagina Impostazioni salva via PUT: stesso comportamento del PATCH (solo impostazioni).
export async function PUT(req: NextRequest) { return PATCH(req) }