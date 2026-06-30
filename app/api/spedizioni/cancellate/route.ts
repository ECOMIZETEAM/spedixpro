import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const numero = p.get('numero')
  const dal = p.get('dal')
  const al = p.get('al')

  let query = supabase.from('spedizioni')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .eq('stato', 'annullata')
    .order('created_at', { ascending: false })
    .limit(1000)

  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (numero) query = query.ilike('numero', '%' + numero + '%')
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}