import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// restituisce i contratti con il conteggio delle spedizioni ancora da mettere in distinta
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const dal = p.get('dal')
  const al = p.get('al')

  // prendo le spedizioni senza distinta, filtrate
  let query = supabase.from('spedizioni')
    .select('corriere_id')
    .eq('master_id', utente?.master_id)
    .is('distinta_id', null)
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await query

  // conto per corriere
  const conteggio: Record<string, number> = {}
  for (const s of (speds || [])) {
    const c = (s as any).corriere_id
    if (!c) continue
    conteggio[c] = (conteggio[c] || 0) + 1
  }

  // recupero i nomi dei corrieri
  const { data: corrieri } = await supabase.from('corrieri')
    .select('id,nome_contratto')
    .eq('master_id', utente?.master_id)

  const risultato = (corrieri || []).map((c: any) => ({
    id: c.id,
    nome_contratto: c.nome_contratto,
    da_chiudere: conteggio[c.id] || 0,
  }))
  return NextResponse.json(risultato)
}