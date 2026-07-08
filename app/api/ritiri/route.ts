import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente): i suoi ritiri
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const codRitiro = p.get('codRitiro')
  const dal = p.get('dal')
  const al = p.get('al')

  let db: any = supabase
  let masterFilter: string[] = [utente?.master_id]
  if (masterSel && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const admin = createAdminSupabase()
    const mieiDiscendenti = await sottoAlberoMasterIds(admin, utente.master_id)
    masterFilter = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : ['00000000-0000-0000-0000-000000000000']
    db = admin
  }

  let query = db.from('ritiri')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .in('master_id', masterFilter)
    .order('created_at', { ascending: false })
    .limit(500)

  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (codRitiro) query = query.ilike('cod_ritiro', '%' + codRitiro + '%')
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { error, data } = await supabase.from('ritiri').insert({
    master_id: utente?.master_id,
    ...body
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}