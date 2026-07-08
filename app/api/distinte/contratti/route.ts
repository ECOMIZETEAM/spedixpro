import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// restituisce i contratti con il conteggio delle spedizioni ancora da mettere in distinta
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
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

  // prendo le spedizioni senza distinta, filtrate
  let query = db.from('spedizioni')
    .select('corriere_id')
    .in('master_id', masterFilter)
    .is('distinta_id', null)
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await query

  // conto per corriere
  const conteggio: Record<string, number> = {}
  for (const s of (speds || [])) {
    const c = (s as any).corriere_id
    if (!c) continue
    conteggio[c] = (conteggio[c] || 0) + 1
  }

  // recupero i nomi dei corrieri
  const { data: corrieri } = await db.from('corrieri')
    .select('id,nome_contratto')
    .in('master_id', masterFilter)

  const risultato = (corrieri || []).map((c: any) => ({
    id: c.id,
    nome_contratto: c.nome_contratto,
    da_chiudere: conteggio[c.id] || 0,
  }))
  return NextResponse.json(risultato)
}