import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { generaApiKey } from '@/lib/api-auth'

// Elenca le API key del cliente (una per contratto)
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { data } = await admin.from('api_keys')
    .select('id,corriere_id,nome,chiave,attivo,last_used_at,created_at,corrieri(nome_contratto)')
    .eq('cliente_id', utente.cliente_id)
    .order('created_at', { ascending: false })
  return NextResponse.json(data || [])
}

// Genera una nuova API key per un contratto del cliente
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const corriereId = body.corriereId
  const nome = (body.nome || '').toString().slice(0, 80) || null
  if (!corriereId) return NextResponse.json({ error: 'Contratto obbligatorio' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: cliente } = await admin.from('clienti').select('master_id,listino_cliente_id').eq('id', utente.cliente_id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ error: 'Cliente senza listino' }, { status: 400 })

  // il contratto deve essere nel listino del cliente
  const { data: agg } = await admin.from('listini_clienti_corrieri')
    .select('corriere_id').eq('listino_id', cliente.listino_cliente_id).eq('corriere_id', corriereId).maybeSingle()
  if (!agg) return NextResponse.json({ error: 'Contratto non disponibile per questo cliente' }, { status: 403 })

  const chiave = generaApiKey()
  const { data, error } = await admin.from('api_keys').insert({
    master_id: cliente.master_id, cliente_id: utente.cliente_id, corriere_id: corriereId, chiave, nome, attivo: true,
  }).select('id,corriere_id,nome,chiave,created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
