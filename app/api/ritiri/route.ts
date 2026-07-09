import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente): i suoi ritiri
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const codRitiro = p.get('codRitiro')
  const dal = p.get('dal')
  const al = p.get('al')

  // Cliente: solo i propri ritiri.
  if (utente?.ruolo === 'cliente') {
    let q = supabase.from('ritiri').select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
      .eq('master_id', utente.master_id).eq('cliente_id', utente.cliente_id)
      .order('created_at', { ascending: false }).limit(500)
    if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data || [])
  }

  // Master/admin: rete = sé + discendenza. Risale la catena ANCHE con "Tutti i clienti".
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const admin = createAdminSupabase()
  let masterFilter: string[] = ['00000000-0000-0000-0000-000000000000']
  if (utente?.master_id) {
    if (masterSel) {
      const mieiDiscendenti = await sottoAlberoMasterIds(admin, utente.master_id)
      masterFilter = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : ['00000000-0000-0000-0000-000000000000']
    } else {
      masterFilter = await sottoAlberoMasterIds(admin, utente.master_id)
    }
  }
  const db: any = masterFilter.length > 1 ? admin : supabase

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

  // Etichetta col nome del sotto-master per i ritiri della rete (null per i miei).
  let out = data || []
  if (masterFilter.length > 1) {
    const { data: ms } = await admin.from('masters').select('id,nome').in('id', masterFilter)
    const nomeById = new Map((ms || []).map((m: any) => [m.id, m.nome]))
    out = (data || []).map((r: any) => ({ ...r, master_rete: r.master_id !== utente?.master_id ? (nomeById.get(r.master_id) || null) : null }))
  }
  return NextResponse.json(out)
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