import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// GET: contratti del listino del cliente + stato abilitato
export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: cliente } = await supabase.from('clienti').select('listino_cliente_id').eq('id', id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json([])

  const { data: agganci } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', cliente.listino_cliente_id)
  const contratti = (agganci||[]).map((r:any) => r.corrieri).filter(Boolean)

  const { data: stati } = await supabase.from('clienti_corrieri_abilitati')
    .select('corriere_id, abilitato').eq('cliente_id', id)
  const mappaStati = new Map((stati||[]).map((s:any) => [s.corriere_id, s.abilitato]))

  const risultato = contratti.map((c:any) => ({
    id: c.id, nome_contratto: c.nome_contratto, tipo: c.tipo,
    abilitato: mappaStati.has(c.id) ? mappaStati.get(c.id) : true,
  }))
  return NextResponse.json(risultato)
}

// POST: salva lo stato abilitato di un contratto per il cliente
export async function POST(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { corriereId, abilitato } = await req.json()
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })

  const { error } = await supabase.from('clienti_corrieri_abilitati')
    .upsert({ cliente_id: id, corriere_id: corriereId, abilitato }, { onConflict: 'cliente_id,corriere_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}