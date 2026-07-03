import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json([])
  const { data } = await supabase.from('spedizioni')
    .select('numero,dest_nome,dest_indirizzo,dest_cap,dest_citta,dest_provincia,rif_destinatario,assicurazione,contrassegno,colli,peso_reale')
    .eq('master_id', utente?.master_id)
    .eq('distinta_id', id)
    .order('created_at', { ascending: true })
  return NextResponse.json(data || [])
}