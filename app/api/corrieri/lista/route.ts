import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('corrieri')
    .select('id,nome_contratto,tipo,multicollo,inserimento_ritiri,settings,attivo')
    .eq('master_id', utente?.master_id)
    .order('nome_contratto')
  // Contratti messi in pausa da un master SOPRA: per chi sta sotto non devono nemmeno comparire.
  // Chi lo ha messo in pausa continua invece a vederlo qui (la sospensione e' sua, e da questa
  // schermata lo riattiva): contrattiSospesiSopra guarda solo gli ANTENATI, non il proprio livello.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesi = await contrattiSospesiSopra(utente?.master_id)
  return NextResponse.json((data || []).filter((c: any) => !sospesoDallaCatena(c.nome_contratto, sospesi)))
}