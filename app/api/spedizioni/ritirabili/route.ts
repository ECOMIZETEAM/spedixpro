import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const admin = createAdminSupabase()
  const isCliente = utente.ruolo === 'cliente'

  // Master: vede tutta la propria rete (sotto-albero). Cliente: solo le proprie.
  const masterIds = isCliente ? [utente.master_id] : await sottoAlberoMasterIds(admin, utente.master_id)

  // Ritirabile = non ancora messa in un ritiro (ritiro_id null) e non consegnata/annullata.
  // Prima filtravamo solo 'in_lavorazione', ma il tracking/marketplace sposta lo stato a
  // 'spedita'/'in_transito' anche se il corriere NON l'ha ancora ritirata -> spariva dai ritirabili.
  let query = admin
    .from('spedizioni')
    .select('id,numero,dest_nome,dest_citta,colli,peso_reale,corriere_id,cliente_id,master_id,raw_response,created_at,corrieri(tipo,nome_contratto)')
    .in('master_id', masterIds)
    .in('stato', ['in_lavorazione', 'spedita', 'in_transito'])
    .is('ritiro_id', null)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (isCliente) query = query.eq('cliente_id', utente.cliente_id)
  // Agente: solo spedizioni dei suoi clienti.
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))

  const { data: spedizioni, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Solo spedizioni spedisci.online / spediamopro hanno i dati per il ritiro
  const raw = (spedizioni || []).filter((s: any) => (s.corrieri?.tipo === 'spedisci' || s.corrieri?.tipo === 'spediamopro'))

  // Risolvo i nomi di master e clienti per il filtro "cliente/master" (solo master)
  const mastMap = new Map<string, string>()
  const cliMap = new Map<string, string>()
  if (!isCliente) {
    const mIds = [...new Set(raw.map((s: any) => s.master_id).filter(Boolean))]
    const cIds = [...new Set(raw.map((s: any) => s.cliente_id).filter(Boolean))]
    if (mIds.length) {
      const { data: ms } = await admin.from('masters').select('id,nome').in('id', mIds)
      for (const m of (ms || [])) mastMap.set(m.id, m.nome || '—')
    }
    if (cIds.length) {
      const { data: cs } = await admin.from('clienti').select('id,ragione_sociale').in('id', cIds)
      for (const c of (cs || [])) cliMap.set(c.id, c.ragione_sociale || '—')
    }
  }

  const out = raw.map((s: any) => {
    // "origine": chi ha fatto la spedizione (cliente se c'è, altrimenti il master proprietario)
    let origine_id: string, origine_nome: string
    if (s.cliente_id) { origine_id = s.cliente_id; origine_nome = cliMap.get(s.cliente_id) || 'Cliente' }
    else { origine_id = s.master_id; origine_nome = mastMap.get(s.master_id) || 'Diretto' }
    return {
      id: s.id, numero: s.numero, dest_nome: s.dest_nome, dest_citta: s.dest_citta,
      colli: s.colli, peso_reale: s.peso_reale, created_at: s.created_at,
      corriere_id: s.corriere_id,
      corriere_nome: (s.corrieri as any)?.nome_contratto || '—',
      corriere_tipo: (s.corrieri as any)?.tipo || '',
      origine_id, origine_nome,
    }
  })

  return NextResponse.json(out)
}
