import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente)
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato')
  const statoContrassegno = p.get('statoContrassegno')
  const dal = p.get('dal')
  const al = p.get('al')

  let db: any = supabase
  let subtreeSel: string[] | null = null
  if (masterSel && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await sottoAlberoMasterIds(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  }

  let query = db.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .gt('contrassegno', 0)
    .order('created_at', { ascending: false })
    .limit(500)

  if (subtreeSel) query = query.in('master_id', subtreeSel)
  else query = query.eq('master_id', utente?.master_id)
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (stato) query = query.eq('stato', stato)
  if (statoContrassegno) query = query.eq('stato_contrassegno', statoContrassegno)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')

  const { data } = await query
  return NextResponse.json(data || [])
}