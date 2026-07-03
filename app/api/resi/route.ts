import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const ldv = req.nextUrl.searchParams.get('ldv')
  if (!ldv) return NextResponse.json({ error: 'LDV obbligatoria' }, { status: 400 })
  const { data: spedizione } = await supabase.from('spedizioni')
    .select('id,numero,mitt_nome,dest_nome,dest_citta,colli,costo_totale,stato,tracking_number,cliente_id')
    .eq('master_id', utente?.master_id)
    .or(`numero.eq.${ldv},tracking_number.eq.${ldv}`)
    .single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // anti-duplicato: se gia in reso, non riprenderla
  if (spedizione.stato === 'reso_mittente') return NextResponse.json({ error: 'Spedizione gia messa in reso e addebitata' }, { status: 400 })
  return NextResponse.json(spedizione)
}