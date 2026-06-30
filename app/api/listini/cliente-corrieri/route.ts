import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { searchParams } = new URL(req.url)
  const listinoId = searchParams.get('listinoId')
  if (!listinoId) return NextResponse.json([])
  const { data } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', listinoId)
  return NextResponse.json((data||[]).map((r:any) => r.corrieri))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  const { listinoId, corriereId } = body
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })
  const { error } = await supabase.from('listini_clienti_corrieri').insert({
    listino_id: listinoId, corriere_id: corriereId,
  })
  if (error && !error.message.includes('duplicate')) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}