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

// PATCH: modifica una regione esistente (body: { capId, paese, provincia, cap, citta })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  const capId = body.capId
  if (!capId) return NextResponse.json({ error: 'capId mancante' }, { status: 400 })
  const paese = (body.paese || '').toUpperCase().trim()
  if (!paese) return NextResponse.json({ error: 'Paese obbligatorio' }, { status: 400 })
  const patch = {
    paese,
    provincia: (body.provincia || '*').toUpperCase().trim() || '*',
    cap: (body.cap || '*').trim() || '*',
    citta: (body.citta || '*').trim() || '*',
  }
  const { data, error } = await supabase.from('zone_cap').update(patch).eq('id', capId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// PUT: import massivo di regioni (formato spedisci.online: country_id/province/cap/city).
// body: { rows: [{paese,provincia,cap,citta}], replace?: boolean }
// replace=true svuota le regioni esistenti della zona prima di inserire.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  const rows = Array.isArray(body.rows) ? body.rows : []
  const puliti = rows
    .map((r: any) => ({
      zona_id: id,
      paese: (r.paese || '').toUpperCase().trim(),
      provincia: (r.provincia || '*').toUpperCase().trim() || '*',
      cap: (r.cap || '*').toString().trim() || '*',
      citta: (r.citta || '*').toString().trim() || '*',
    }))
    .filter((r: any) => r.paese)
  if (!puliti.length) return NextResponse.json({ error: 'Nessuna riga valida da importare' }, { status: 400 })

  if (body.replace) {
    await supabase.from('zone_cap').delete().eq('zona_id', id)
  }
  const { data, error } = await supabase.from('zone_cap').insert(puliti).select()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ inserite: data?.length || 0 })
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
