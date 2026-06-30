import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('corrieri')
    .select('id,nome_contratto,tipo')
    .eq('master_id', utente?.master_id)
    .order('nome_contratto')
  return NextResponse.json(data || [])
}