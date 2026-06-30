import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { error } = await supabase.from('spedizioni')
    .delete().eq('id', spedizioneId).eq('master_id', utente?.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}