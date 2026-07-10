import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const { data } = await supabase.from('listini_corrieri')
    .select('*, corrieri(nome_contratto,tipo,logo_url), listini_corrieri_fasce(*), listini_corrieri_supplementi(*)')
    .eq('id', id).single()
  return NextResponse.json(data || {})
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()

  // Sola lettura per i sotto-master con listino assegnato dal padre.
  {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: m } = await admin.from('masters').select('parent_listino_id').eq('id', utente?.master_id).maybeSingle()
    if (m?.parent_listino_id) return NextResponse.json({ error: 'Questo listino è assegnato dal tuo master: è in sola lettura e non può essere modificato.' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { fasce, supplementi } = body

  await supabase.from('listini_corrieri_fasce').delete().eq('listino_id', id)
  await supabase.from('listini_corrieri_supplementi').delete().eq('listino_id', id)

  if (fasce?.length) {
    await supabase.from('listini_corrieri_fasce').insert(
      fasce.map((f: any) => ({ ...f, listino_id: id }))
    )
  }
  if (supplementi?.length) {
    await supabase.from('listini_corrieri_supplementi').insert(
      supplementi.map((s: any) => ({ ...s, listino_id: id }))
    )
  }
  return NextResponse.json({ success: true })
}