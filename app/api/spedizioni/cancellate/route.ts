import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { fetchAll } from '@/lib/fetch-all'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const numero = p.get('numero')
  const dal = p.get('dal')
  const al = p.get('al')

  const agIds = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  const build = () => {
    let q = supabase.from('spedizioni')
      .select('*, clienti(ragione_sociale)')
      .eq('master_id', utente?.master_id)
      .eq('stato', 'annullata')
      .order('updated_at', { ascending: false })
    if (agIds) q = q.in('cliente_id', agIds)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    if (numero) q = q.ilike('numero', '%' + numero + '%')
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  }
  return NextResponse.json(await fetchAll(build))
}