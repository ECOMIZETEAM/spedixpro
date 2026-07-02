import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()

  const self = req.nextUrl.searchParams.get('self')

  if (self === '1') {
    if (utente?.ruolo === 'cliente' || !utente?.master_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    const { data: movimenti, error } = await supabase
      .from('movimenti')
      .select('*')
      .eq('master_target_id', utente.master_id)
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const { data: m } = await supabase
      .from('masters').select('credito, nome').eq('id', utente.master_id).single()
    return NextResponse.json({
      movimenti: movimenti || [],
      saldo: Number(m?.credito || 0),
      cliente: m?.nome || null,
    })
  }

  let clienteId: string | null = null
  if (utente?.ruolo === 'cliente') {
    clienteId = utente.cliente_id
    if (!clienteId) return NextResponse.json({ error: 'Cliente non associato' }, { status: 400 })
  } else {
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
  const { data: cli } = await supabase
    .from('clienti').select('credito, ragione_sociale').eq('id', clienteId).single()
  return NextResponse.json({
    movimenti: movimenti || [],
    saldo: Number(cli?.credito || 0),
    cliente: cli?.ragione_sociale || null,
  })
}
