import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const dal = p.get('dal')
  const al = p.get('al')
  let query = supabase.from('distinte')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data } = await query
  return NextResponse.json(data || [])
}