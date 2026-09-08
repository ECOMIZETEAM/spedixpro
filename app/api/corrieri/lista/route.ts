import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('corrieri')
    .select('id,nome_contratto,tipo,multicollo,inserimento_ritiri,settings,attivo,livello,proprio')
    .eq('master_id', utente?.master_id)
    .order('nome_contratto')
  // Contratti messi in pausa da un master SOPRA: il master li VEDE comunque qui, marcati
  // `sospeso_sopra`, ma non li puo' riattivare (lo sblocco tocca a chi li ha fermati — segue la
  // gerarchia). contrattiSospesiSopra guarda solo gli ANTENATI, non il proprio livello (quello e' `attivo`).
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesi = await contrattiSospesiSopra(utente?.master_id)
  return NextResponse.json((data || []).map((c: any) => ({ ...c, sospeso_sopra: sospesoDallaCatena(c.nome_contratto, sospesi) })))
}