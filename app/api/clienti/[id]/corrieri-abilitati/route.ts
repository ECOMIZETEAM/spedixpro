import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
// GET: contratti del listino del cliente + stato abilitato + settings per-contratto
export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato'}, { status: 401 })
  const { data: cliente } = await supabase.from('clienti').select('listino_cliente_id').eq('id', id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json([])
  const { data: agganci } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', cliente.listino_cliente_id)
  const contratti = (agganci||[]).map((r:any) => r.corrieri).filter(Boolean)
  const { data: stati } = await supabase.from('clienti_corrieri_abilitati')
    .select('corriere_id, abilitato, settings').eq('cliente_id', id)
  const mappaAbil = new Map((stati||[]).map((s:any) => [s.corriere_id, s.abilitato]))
  const mappaSett = new Map((stati||[]).map((s:any) => [s.corriere_id, s.settings || {}]))
  const risultato = contratti.map((c:any) => ({
    id: c.id, nome_contratto: c.nome_contratto, tipo: c.tipo,
    abilitato: mappaAbil.has(c.id) ? mappaAbil.get(c.id) : true,
    settings: mappaSett.has(c.id) ? mappaSett.get(c.id) : {},
  }))
  return NextResponse.json(risultato)
}
// POST: salva abilitato e/o settings di un contratto per il cliente (solo i campi presenti)
export async function POST(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato'}, { status: 401 })
  const { corriereId, abilitato, settings } = await req.json()
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })
  const payload: any = { cliente_id: id, corriere_id: corriereId }
  if (abilitato !== undefined) payload.abilitato = abilitato
  if (settings !== undefined) payload.settings = settings
  const { error } = await supabase.from('clienti_corrieri_abilitati')
    .upsert(payload, { onConflict: 'cliente_id,corriere_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}