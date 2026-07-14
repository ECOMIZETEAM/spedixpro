import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  // Agente: solo i ritiri dei suoi clienti.
  if ((utente.ruolo || '').toLowerCase() === 'agente') {
    const { isAgente, clientiAgente, idClientiPerFiltro } = await import('@/lib/agente')
    const ids = idClientiPerFiltro(await clientiAgente(supabase, utente))
    const { data: ritiri, error } = await supabase.from('ritiri').select('*, clienti(ragione_sociale)')
      .eq('master_id', utente.master_id).in('cliente_id', ids)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(ritiri || [])
  }

  // Cliente: solo i propri ritiri.
  if (utente.ruolo === 'cliente') {
    const { data: ritiri, error } = await supabase.from('ritiri').select('*, clienti(ragione_sociale)')
      .eq('master_id', utente.master_id).eq('cliente_id', utente.cliente_id)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(ritiri || [])
  }

  // Master/admin: vede i ritiri di TUTTA la sua rete (sé + discendenza), risalendo la catena.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { masterIdsVisibili } = await import('@/lib/rete-masters')
  const admin = createAdminSupabase()
  const masterIds = await masterIdsVisibili(admin, utente.master_id)
  const db = masterIds.length > 1 ? admin : supabase
  const { data: ritiri, error } = await db.from('ritiri').select('*, clienti(ragione_sociale)')
    .in('master_id', masterIds)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Etichetta col nome del sotto-master per i ritiri della rete (null per i miei).
  let out = ritiri || []
  if (masterIds.length > 1) {
    const { data: ms } = await admin.from('masters').select('id,nome').in('id', masterIds)
    const nomeById = new Map((ms || []).map((m: any) => [m.id, m.nome]))
    out = (ritiri || []).map((r: any) => ({
      ...r,
      master_rete: r.master_id !== utente.master_id ? (nomeById.get(r.master_id) || null) : null,
    }))
  }
  return NextResponse.json(out)
}
