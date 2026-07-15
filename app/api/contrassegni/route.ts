import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
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
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  }

  // Agente: solo contrassegni dei suoi clienti (calcolato una volta, fuori dal loop).
  const agIds = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  const buildBase = () => {
    let q = db.from('spedizioni')
      .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
      .gt('contrassegno', 0)
      .order('created_at', { ascending: false })
    if (subtreeSel) q = q.in('master_id', subtreeSel)
    else q = q.eq('master_id', utente?.master_id)
    if (agIds) q = q.in('cliente_id', agIds)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    if (stato) q = q.eq('stato', stato)
    if (statoContrassegno) q = q.eq('stato_contrassegno', statoContrassegno)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  }
  // Carico TUTTI i contrassegni a blocchi (prima .limit(500) tagliava): sono spedizioni normali.
  const data: any[] = []
  for (let from = 0; from < 10000; from += 1000) {
    const { data: batch } = await buildBase().range(from, from + 999)
    if (!batch?.length) break
    data.push(...batch)
    if (batch.length < 1000) break
  }
  return NextResponse.json(data)
}