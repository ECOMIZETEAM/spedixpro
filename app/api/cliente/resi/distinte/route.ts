import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  const { data } = await query
  return NextResponse.json(data || [])
}