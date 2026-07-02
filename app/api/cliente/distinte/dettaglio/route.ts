import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { data: distinta } = await supabase
    .from('distinte').select('id,numero,data,created_at,corriere_id,cliente_id').eq('id', id).eq('cliente_id', clienteId).single()
  if (!distinta) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  const { data: speds } = await supabase
    .from('spedizioni')
    .select('numero,rif_mittente,rif_destinatario,dest_nome,dest_indirizzo,dest_cap,dest_citta,dest_provincia,dest_telefono,peso_reale,peso_fatturato,peso_volume,colli,contrassegno,assicurazione,costo_totale')
    .eq('distinta_id', id)
    .order('numero', { ascending: true })
  return NextResponse.json({ distinta, spedizioni: speds || [] })
}