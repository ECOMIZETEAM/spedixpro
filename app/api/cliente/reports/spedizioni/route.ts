import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
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
  const buildBase = () => {
    let q = supabase.from('spedizioni')
      .select('*, clienti(ragione_sociale)')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
    if (stato) q = q.eq('stato', stato)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    if (contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (contrassegno === 'no') q = q.eq('contrassegno', 0)
    if (provincia) q = q.eq('dest_provincia', provincia)
    return q
  }
  // Report COMPLETO a blocchi (il DB tronca a 1000/query). Nessun limite pratico.
  return NextResponse.json(await fetchAll(buildBase))
}