import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const tipo = req.nextUrl.searchParams.get('tipo')
  let query = supabase.from('reports_generati')
    .select('*')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (tipo) query = query.eq('tipo', tipo)
  const { data } = await query
  return NextResponse.json(data || [])
}