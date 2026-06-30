import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('rettifiche_files')
    .select('*')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
    .limit(20)
  return NextResponse.json(data || [])
}