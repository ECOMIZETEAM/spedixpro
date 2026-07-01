import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const { error } = await supabase
    .from('corrieri')
    .delete()
    .eq('id', id)
    .eq('master_id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const campi: any = {}
  if (body.attivo !== undefined) campi.attivo = body.attivo
  if (body.multicollo !== undefined) campi.multicollo = body.multicollo
  if (body.inserimento_ritiri !== undefined) campi.inserimento_ritiri = body.inserimento_ritiri
  if (body.settings !== undefined) campi.settings = body.settings
  const { error } = await supabase
    .from('corrieri')
    .update(campi)
    .eq('id', id)
    .eq('master_id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}