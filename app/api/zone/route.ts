import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('zone').select('*, corrieri(nome_contratto,tipo), zone_cap(paese,provincia,cap,citta)').eq('master_id', utente?.master_id).order('nome')
  // Mostra solo le zone dei corrieri POSSEDUTI dal master (no residui estranei da duplicazioni).
  const { data: miei } = await supabase.from('corrieri').select('id').eq('master_id', utente?.master_id)
  const posseduti = new Set((miei || []).map((c:any) => c.id))
  const filtrate = (data || []).filter((z:any) => !z.corriere_id || posseduti.has(z.corriere_id))
  return NextResponse.json(filtrate)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { nome, descrizione, con_fuel, corriereId } = body
  const { data, error } = await supabase.from('zone').insert({
    master_id: utente?.master_id,
    corriere_id: corriereId,
    nome, descrizione, con_fuel: con_fuel || false,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}