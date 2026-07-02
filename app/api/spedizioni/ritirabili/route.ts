import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  let query = supabase
    .from('spedizioni')
    .select('id,numero,dest_nome,dest_citta,colli,peso_reale,corriere_id,raw_response,created_at,corrieri(tipo,nome_contratto)')
    .eq('master_id', utente.master_id)
    .eq('stato', 'in_lavorazione')
    .order('created_at', { ascending: false })
    .limit(50)

  if (utente.ruolo === 'cliente') {
    query = query.eq('cliente_id', utente.cliente_id)
  }

  const { data: spedizioni, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Solo spedizioni spedisci.online hanno contractCode/carrierCode utilizzabile per ritiro
  const ritirabili = (spedizioni || []).filter((s: any) => (s.corrieri?.tipo === 'spedisci' || s.corrieri?.tipo === 'spediamopro'))

  return NextResponse.json(ritirabili)
}
