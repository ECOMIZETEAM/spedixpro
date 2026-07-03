import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')
  const numero = p.get('numero')
  const destCitta = p.get('dest_citta')
  const destCap = p.get('dest_cap')
  const contenuto = p.get('contenuto')
  const contrassegno = p.get('contrassegno')
  const ordinaPer = (stato === 'annullata') ? 'updated_at' : 'created_at'
  let query = supabase.from('spedizioni').select('*,clienti(ragione_sociale),corrieri(id,nome_contratto)').order(ordinaPer, { ascending: false }).limit(200)
  if (clienteId) {
    query = query.eq('cliente_id', clienteId).eq('master_id', utente?.master_id)
  } else if (utente?.ruolo === 'cliente') {
    query = query.eq('cliente_id', utente.cliente_id)
  } else {
    query = query.eq('master_id', utente?.master_id)
  }
  // Filtro stato: se richiesto uno stato preciso lo applico; se non richiesto,
  // escludo le annullate (che vivono nella pagina "Spedizioni Cancellate").
  if (stato && stato !== 'tutti') query = query.eq('stato', stato)
  else query = query.neq('stato', 'annullata')
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (numero) query = query.ilike('numero', `%${numero}%`)
  if (destCitta) query = query.ilike('dest_citta', `%${destCitta}%`)
  if (destCap) query = query.ilike('dest_cap', `%${destCap}%`)
  if (contenuto) query = query.ilike('contenuto', `%${contenuto}%`)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  const { data: spedizioni, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(spedizioni || [])
}
