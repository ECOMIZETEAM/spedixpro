import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  const body = await req.json()
  const { distinteIds } = body
  if (!distinteIds?.length) return NextResponse.json({ error: 'Nessuna distinta selezionata' }, { status: 400 })
  const { error } = await supabase.from('distinte')
    .update({ confermata_vettore: true, data_conferma: new Date().toISOString() })
    .in('id', distinteIds)
    .eq('master_id', utente?.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, confermate: distinteIds.length })
}