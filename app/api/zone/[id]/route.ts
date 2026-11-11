import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const { error } = await supabase.from('zone').update(body).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Il segno multicollo (e il fuel) devono valere anche nelle copie dei sotto-master: una zona multicollo
  // che a valle resta "normale" diventerebbe una destinazione del collo singolo con righe "tutto il paese".
  if (body && (body.multicollo !== undefined || body.con_fuel !== undefined)) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sincronizzaZonaAiDiscendenti } = await import('@/lib/propaga-zona')
    try { await sincronizzaZonaAiDiscendenti(createAdminSupabase(), id) } catch (e: any) { console.error('[ZONE] propagazione del segno', id, e?.message) }
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const { error } = await supabase.from('zone').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}