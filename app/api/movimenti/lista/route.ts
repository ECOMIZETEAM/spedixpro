import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()

  // L'agente non vede movimenti/credito (dati del master).
  if ((utente?.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non disponibile per gli agenti.' }, { status: 403 })

  const self = req.nextUrl.searchParams.get('self')

  if (self === '1') {
    if (utente?.ruolo === 'cliente' || !utente?.master_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    const movimenti = await fetchAll(() => supabase
      .from('movimenti')
      .select('*')
      .eq('master_target_id', utente.master_id)
      .order('created_at', { ascending: false }))
    const { data: m } = await supabase
      .from('masters').select('credito, nome').eq('id', utente.master_id).single()

    // Corriere di ogni movimento di spedizione: movimento -> spedizione_id -> corriere (nome contratto).
    // Le spedizioni possono essere di sotto-master (cross-master) -> lettura via admin.
    const movs = movimenti || []
    const spedIds = Array.from(new Set(movs.map((mv: any) => mv.spedizione_id).filter(Boolean)))
    const nomePerSped = new Map<string, string | null>()
    if (spedIds.length) {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const admin = createAdminSupabase()
      const { data: speds } = await admin.from('spedizioni').select('id,corrieri(nome_contratto)').in('id', spedIds)
      for (const s of (speds || [])) nomePerSped.set(s.id, (s.corrieri as any)?.nome_contratto || null)
    }
    const movimentiOut = movs.map((mv: any) => ({
      ...mv,
      corriere: mv.spedizione_id ? (nomePerSped.get(mv.spedizione_id) || null) : null,
    }))
    return NextResponse.json({
      movimenti: movimentiOut,
      saldo: Number(m?.credito || 0),
      cliente: m?.nome || null,
    })
  }

  let clienteId: string | null = null
  if (utente?.ruolo === 'cliente') {
    clienteId = utente.cliente_id
    if (!clienteId) return NextResponse.json({ error: 'Cliente non associato' }, { status: 400 })
  } else {
    clienteId = req.nextUrl.searchParams.get('clienteId')
    if (!clienteId) return NextResponse.json({ error: 'clienteId mancante' }, { status: 400 })

    // Sotto-master (clienteId = "m:<masterId>"): movimenti tra master + saldo del sotto-master
    if (clienteId.startsWith('m:')) {
      const targetId = clienteId.slice(2)
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const admin = createAdminSupabase()
      const { data: sub } = await admin.from('masters').select('id,parent_master_id,credito,nome').eq('id', targetId).single()
      // Autorizzato se il mio master è un ANTENATO (figlio diretto o più in basso nella rete).
      let cur: string | null = sub?.parent_master_id || null
      let autorizzato = false
      for (let i = 0; i < 20 && cur; i++) {
        if (cur === utente?.master_id) { autorizzato = true; break }
        const { data: p } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        cur = p?.parent_master_id || null
      }
      if (!sub || !autorizzato) {
        return NextResponse.json({ error: 'Sotto-master non trovato o non autorizzato' }, { status: 403 })
      }
      const movimenti = await fetchAll(() => admin.from('movimenti').select('*')
        .eq('master_target_id', targetId).order('created_at', { ascending: false }))
      return NextResponse.json({ movimenti, saldo: Number(sub.credito || 0), cliente: sub.nome || null })
    }

    const { data: cli } = await supabase
      .from('clienti').select('id, master_id').eq('id', clienteId).single()
    if (!cli || cli.master_id !== utente?.master_id) {
      // Fallback: id di un SOTTO-MASTER inviato senza prefisso m: → ne mostro movimenti/saldo
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const admin = createAdminSupabase()
      const { data: sub } = await admin.from('masters').select('id,parent_master_id,credito,nome').eq('id', clienteId).maybeSingle()
      if (sub) {
        let cur: string | null = sub.parent_master_id || null
        let autorizzato = false
        for (let i = 0; i < 20 && cur; i++) {
          if (cur === utente?.master_id) { autorizzato = true; break }
          const { data: p } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
          cur = p?.parent_master_id || null
        }
        if (autorizzato) {
          const movimenti = await fetchAll(() => admin.from('movimenti').select('*')
            .eq('master_target_id', clienteId).order('created_at', { ascending: false }))
          return NextResponse.json({ movimenti, saldo: Number(sub.credito || 0), cliente: sub.nome || null })
        }
      }
      return NextResponse.json({ error: 'Cliente non trovato o non autorizzato' }, { status: 403 })
    }
  }
  const movimenti = await fetchAll(() => supabase
    .from('movimenti')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false }))
  const { data: cli } = await supabase
    .from('clienti').select('credito, ragione_sociale').eq('id', clienteId).single()
  return NextResponse.json({
    movimenti: movimenti || [],
    saldo: Number(cli?.credito || 0),
    cliente: cli?.ragione_sociale || null,
  })
}
