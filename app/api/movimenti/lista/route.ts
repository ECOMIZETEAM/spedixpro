import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()

  let clienteId: string | null = null

  if (utente?.ruolo === 'cliente') {
    // Cliente: solo i propri movimenti
    clienteId = utente.cliente_id
    if (!clienteId) return NextResponse.json({ error: 'Cliente non associato' }, { status: 400 })
  } else {
    // Master: deve indicare quale cliente, e dev'essere un suo cliente
    clienteId = req.nextUrl.searchParams.get('clienteId')
    if (!clienteId) return NextResponse.json({ error: 'clienteId mancante' }, { status: 400 })
    const { data: cli } = await supabase
      .from('clienti').select('id, master_id').eq('id', clienteId).single()
    if (!cli || cli.master_id !== utente?.master_id) {
      return NextResponse.json({ error: 'Cliente non trovato o non autorizzato' }, { status: 403 })
    }
  }

  const { data: movimenti, error } = await supabase
    .from('movimenti')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Saldo attuale del cliente
  const { data: cli } = await supabase
    .from('clienti').select('credito, ragione_sociale').eq('id', clienteId).single()

  return NextResponse.json({
    movimenti: movimenti || [],
    saldo: Number(cli?.credito || 0),
    cliente: cli?.ragione_sociale || null,
  })
}
