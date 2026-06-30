import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { clienteId, descrizione, prezzoUnitario, quantita, iva, vettore, dataAcquisto } = body
  if (!clienteId) return NextResponse.json({ error: 'Cliente obbligatorio' }, { status: 400 })
  if (!descrizione) return NextResponse.json({ error: 'Descrizione obbligatoria' }, { status: 400 })
  const importo = parseFloat(prezzoUnitario) * parseInt(quantita)
  const totaleIva = importo * (parseFloat(iva) / 100)
  const totale = importo + totaleIva
  const { error } = await supabase.from('movimenti_clienti').insert({
    master_id: utente?.master_id,
    cliente_id: clienteId,
    tipo: 'addebito',
    descrizione,
    prezzo_unitario: parseFloat(prezzoUnitario),
    quantita: parseInt(quantita),
    iva: parseFloat(iva),
    importo,
    totale_iva: totaleIva,
    totale,
    vettore: vettore || null,
    data_acquisto: dataAcquisto,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const clienteId = req.nextUrl.searchParams.get('clienteId')
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('movimenti_clienti')
    .select('id,tipo,descrizione,prezzo_unitario,quantita,iva,totale,credito_residuo,data_acquisto,created_at,clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('data_acquisto', dal)
  if (al) query = query.lte('data_acquisto', al)
  const { data } = await query
  return NextResponse.json(data || [])
}