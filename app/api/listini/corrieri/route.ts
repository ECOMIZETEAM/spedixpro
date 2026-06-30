import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('listini_corrieri')
    .select('*, corrieri(nome_contratto,tipo,logo_url), listini_corrieri_fasce(*), listini_corrieri_supplementi(*)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { corriereId, nome, fasce, supplementi } = body

  const { data: listino, error } = await supabase.from('listini_corrieri').insert({
    master_id: utente?.master_id,
    corriere_id: corriereId,
    nome: nome,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (fasce?.length) {
    await supabase.from('listini_corrieri_fasce').insert(
      fasce.map((f: any) => ({ ...f, listino_id: listino.id, corriere_id: corriereId }))
    )
  }
  if (supplementi?.length) {
    await supabase.from('listini_corrieri_supplementi').insert(
      supplementi.map((s: any) => ({ ...s, listino_id: listino.id, corriere_id: corriereId }))
    )
  }
  return NextResponse.json(listino)
}