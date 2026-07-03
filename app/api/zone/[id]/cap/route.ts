import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// GET: elenca le regioni (zone_cap) di una zona
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data } = await supabase.from('zone_cap').select('*').eq('zona_id', id).order('paese')
  return NextResponse.json(data || [])
}

// POST: aggiunge una regione alla zona
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  const paese = (body.paese || '').toUpperCase().trim()
  const provincia = (body.provincia || '*').toUpperCase().trim() || '*'
  const cap = (body.cap || '*').trim() || '*'
  const citta = (body.citta || '*').trim() || '*'
  if (!paese) return NextResponse.json({ error: 'Paese obbligatorio' }, { status: 400 })
  const { data, error } = await supabase.from('zone_cap').insert({
    zona_id: id, paese, provincia, cap, citta,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// DELETE: rimuove una regione (passando ?capId=...)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const capId = req.nextUrl.searchParams.get('capId')
  if (!capId) return NextResponse.json({ error: 'capId mancante' }, { status: 400 })
  const { error } = await supabase.from('zone_cap').delete().eq('id', capId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
