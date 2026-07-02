import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const p = req.nextUrl.searchParams
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')
  const contrassegno = p.get('contrassegno')
  const provincia = p.get('provincia')
  let query = supabase.from('spedizioni')
    .select('*, clienti(ragione_sociale)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  if (provincia) query = query.eq('dest_provincia', provincia)
  const { data } = await query
  return NextResponse.json(data || [])
}