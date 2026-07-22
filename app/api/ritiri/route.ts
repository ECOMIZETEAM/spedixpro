import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'


// STATO RITIRI SPEDIAMOPRO: rinfresca best-effort dai pickup live (GET /pickups/{id}).
// Mappa: status >= 4 -> 'elaborato' (preso in carico dal corriere), 1..3 -> 'prenotato'.
// Solo i non-finali col pickup_id, max 40 per giro, batch paralleli: la lista resta veloce.
async function rinfrescaStatiPickup(adminDb: any, lista: any[]) {
  try {
    const daAggiornare = (lista || []).filter((r: any) => r.pickup_id && !['elaborato', 'annullato', 'completato'].includes(r.stato)).slice(0, 40)
    if (!daAggiornare.length) return
    const corrIds = Array.from(new Set(daAggiornare.map((r: any) => r.corriere_id).filter(Boolean)))
    const { data: corrs } = await adminDb.from('corrieri').select('id,tipo,credenziali').in('id', corrIds)
    const credPer = new Map((corrs || []).filter((c: any) => c.tipo === 'spediamopro').map((c: any) => [c.id, (c.credenziali || {}).authcode]))
    const { spediamoproGetPickup } = await import('@/lib/spediamopro')
    const BATCH = 8
    for (let i = 0; i < daAggiornare.length; i += BATCH) {
      await Promise.all(daAggiornare.slice(i, i + BATCH).map(async (r: any) => {
        const ac = credPer.get(r.corriere_id)
        if (!ac) return
        try {
          // NB: spediamoproGetPickup ritorna GIÀ il contenuto di data ({status,...}), non l'involucro.
          const j = await spediamoproGetPickup(ac, Number(r.pickup_id))
          const st = Number(j?.status ?? j?.data?.status)
          const nuovo = st >= 4 ? 'elaborato' : (st >= 1 ? 'prenotato' : null)
          if (nuovo && nuovo !== r.stato) { r.stato = nuovo; await adminDb.from('ritiri').update({ stato: nuovo }).eq('id', r.id) }
        } catch { /* best-effort */ }
      }))
    }
  } catch { /* la lista esce comunque */ }
}

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
    const build = () => {
      let q = supabase.from('ritiri').select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
        .eq('master_id', utente.master_id).eq('cliente_id', utente.cliente_id)
        .order('created_at', { ascending: false })
      if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
      if (dal) q = q.gte('created_at', dal)
      if (al) q = q.lte('created_at', al + 'T23:59:59')
      return q
    }
    const lista = await fetchAll(build)
    const { createAdminSupabase: _admR } = await import('@/lib/supabase-admin')
    await rinfrescaStatiPickup(_admR(), lista)
    return NextResponse.json(lista)
  }

  // Master/admin: rete = sé + discendenza. Risale la catena ANCHE con "Tutti i clienti".
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
  const admin = createAdminSupabase()
  let masterFilter: string[] = ['00000000-0000-0000-0000-000000000000']
  if (utente?.master_id) {
    if (masterSel) {
      const mieiDiscendenti = await masterIdsVisibili(admin, utente.master_id)
      masterFilter = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : ['00000000-0000-0000-0000-000000000000']
    } else {
      masterFilter = await masterIdsVisibili(admin, utente.master_id)
    }
  }
  const db: any = masterFilter.length > 1 ? admin : supabase

  const build = () => {
    let q = db.from('ritiri')
      .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
      .in('master_id', masterFilter)
      .order('created_at', { ascending: false })
    if (clienteId) q = q.eq('cliente_id', clienteId)
    if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  }
  const data = await fetchAll(build)
  await rinfrescaStatiPickup(admin, data)

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