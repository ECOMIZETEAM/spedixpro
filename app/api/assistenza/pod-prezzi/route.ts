import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Listino POD del master: quanto paga il cliente per ogni richiesta di prova di consegna.
// Solo il MASTER gestisce le proprie regole (mai cliente/agente). Tutto via service-role con
// controllo esplicito del perimetro (cliente/corriere devono essere del master). Vedi lib/pod-prezzo.

// Chi puo' gestire: un master (ha master_id, non e' cliente ne' agente).
async function masterCorrente() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || u.cliente_id || ruolo === 'cliente' || ruolo === 'agente') {
    return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  }
  return { masterId: u.master_id as string, userId: user.id }
}

// GET: le regole del master + gli elenchi (clienti, corrieri propri) per le tendine.
export async function GET() {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const M = ctx.masterId

  const [rg, cl, co] = await Promise.all([
    admin.from('pod_prezzi').select('id,cliente_id,corriere_id,prezzo,attivo,updated_at').eq('master_id', M),
    admin.from('clienti').select('id,ragione_sociale').eq('master_id', M).order('ragione_sociale'),
    admin.from('corrieri').select('id,nome_contratto').eq('master_id', M).eq('attivo', true).order('nome_contratto'),
  ])
  return NextResponse.json({
    regole: rg.data || [],
    clienti: cl.data || [],
    corrieri: co.data || [],
  })
}

// POST: crea o aggiorna UNA regola (upsert per master+cliente+corriere). cliente_id/corriere_id
// nulli = "tutti". Il prezzo puo' essere 0 (POD gratuita esplicita, batte una regola piu' generica).
export async function POST(req: NextRequest) {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const M = ctx.masterId
  const body = await req.json().catch(() => ({}))

  const clienteId = body?.cliente_id ? String(body.cliente_id) : null
  const corriereId = body?.corriere_id ? String(body.corriere_id) : null
  const prezzo = Math.round(Number(body?.prezzo) * 100) / 100
  const attivo = body?.attivo === undefined ? true : !!body.attivo
  if (!isFinite(prezzo) || prezzo < 0) return NextResponse.json({ error: 'Prezzo non valido' }, { status: 400 })

  // Perimetro: cliente e corriere, se indicati, devono essere del master (mai di un altro).
  if (clienteId) {
    const { data } = await admin.from('clienti').select('id').eq('id', clienteId).eq('master_id', M).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Cliente non valido' }, { status: 400 })
  }
  if (corriereId) {
    const { data } = await admin.from('corrieri').select('id').eq('id', corriereId).eq('master_id', M).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Corriere non valido' }, { status: 400 })
  }

  // Upsert manuale: la unique e' su un'espressione (coalesce dei NULL), quindi cerco a mano la regola gemella.
  let q = admin.from('pod_prezzi').select('id').eq('master_id', M)
  q = clienteId ? q.eq('cliente_id', clienteId) : q.is('cliente_id', null)
  q = corriereId ? q.eq('corriere_id', corriereId) : q.is('corriere_id', null)
  const { data: ex } = await q.maybeSingle()

  if (ex) {
    const { error } = await admin.from('pod_prezzi')
      .update({ prezzo, attivo, updated_at: new Date().toISOString() }).eq('id', (ex as any).id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, id: (ex as any).id })
  }
  const { data, error } = await admin.from('pod_prezzi')
    .insert({ master_id: M, cliente_id: clienteId, corriere_id: corriereId, prezzo, attivo })
    .select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, id: data?.id })
}

// DELETE: rimuove una regola del master (solo le proprie).
export async function DELETE(req: NextRequest) {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const M = ctx.masterId
  const body = await req.json().catch(() => ({}))
  const id = String(body?.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Id mancante' }, { status: 400 })
  const { error } = await admin.from('pod_prezzi').delete().eq('id', id).eq('master_id', M)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
