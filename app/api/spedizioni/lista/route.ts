import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  let agenteClienteIds: string[] | null = null
  if ((utente?.ruolo || '').toLowerCase() === 'agente') {
    const nomeAg = (((utente as any)?.nome || '') + ' ' + ((utente as any)?.cognome || '')).trim()
    const { data: cl } = await supabase.from('clienti').select('id').eq('master_id', utente?.master_id).eq('agente', nomeAg)
    agenteClienteIds = (cl || []).map((c: any) => c.id)
  }
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')
  const numero = p.get('numero')
  const destCitta = p.get('dest_citta')
  const destCap = p.get('dest_cap')
  const contenuto = p.get('contenuto')
  const contrassegno = p.get('contrassegno')
  const ordinaPer = (stato === 'annullata') ? 'updated_at' : 'created_at'

  // ── Rete: un master vede anche le spedizioni dei sotto-master (tutta la discendenza),
  //    ma etichettate con la PROPRIA PRIMA LINEA (il figlio diretto attraverso cui
  //    discende la spedizione). Es: io->MASSIMO->GIOVANNI: le spedizioni di Giovanni
  //    le vedo sotto "MASSIMO" (la mia prima linea). ──
  const ruolo = (utente?.ruolo || '').toLowerCase()
  const isMasterRete = ruolo !== 'cliente' && ruolo !== 'agente' && !clienteId && agenteClienteIds === null
  let db: any = supabase
  let masterIds: string[] | null = null
  const primaLineaId = new Map<string, string>()  // master discendente -> id del figlio diretto (prima linea)
  const nomeMaster = new Map<string, string>()     // master id -> nome
  if (isMasterRete && utente?.master_id) {
    const mine = utente.master_id
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminDb = createAdminSupabase()
    masterIds = [mine]
    let frontier = [mine]
    for (let i = 0; i < 12 && frontier.length; i++) {
      const { data: figli } = await adminDb.from('masters').select('id,nome,parent_master_id').in('parent_master_id', frontier)
      const nuovi: string[] = []
      for (const c of (figli || [])) {
        if (masterIds.includes(c.id)) continue
        nomeMaster.set(c.id, c.nome)
        // prima linea = il figlio diretto se il padre sono io, altrimenti eredita quella del padre
        primaLineaId.set(c.id, c.parent_master_id === mine ? c.id : (primaLineaId.get(c.parent_master_id) || c.id))
        masterIds.push(c.id); nuovi.push(c.id)
      }
      frontier = nuovi
    }
    if (masterIds.length > 1) db = adminDb  // servono i permessi cross-master (RLS)
  }

  // Solo colonne leggere (SPED_COLS): esclusi etichetta_url/raw_response/colli_dettaglio.
  let query = db.from('spedizioni').select(`${SPED_COLS},clienti(ragione_sociale),corrieri(id,nome_contratto)`).order(ordinaPer, { ascending: false }).limit(200)
  if (clienteId) {
    query = query.eq('cliente_id', clienteId).eq('master_id', utente?.master_id)
  } else if (utente?.ruolo === 'cliente') {
    query = query.eq('cliente_id', utente.cliente_id)
  } else if (masterIds && masterIds.length > 1) {
    query = query.in('master_id', masterIds)
  } else {
    query = query.eq('master_id', utente?.master_id)
  }
  // Filtro stato: se richiesto uno stato preciso lo applico; se non richiesto,
  // escludo le annullate (che vivono nella pagina "Spedizioni Cancellate").
  if (stato && stato !== 'tutti') query = query.eq('stato', stato)
  else query = query.neq('stato', 'annullata')
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (numero) query = query.ilike('numero', `%${numero}%`)
  if (destCitta) query = query.ilike('dest_citta', `%${destCitta}%`)
  if (destCap) query = query.ilike('dest_cap', `%${destCap}%`)
  if (contenuto) query = query.ilike('contenuto', `%${contenuto}%`)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  if (agenteClienteIds !== null) query = query.in('cliente_id', agenteClienteIds.length ? agenteClienteIds : ['00000000-0000-0000-0000-000000000000'])
  const { data: spedizioni, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // master_rete = nome della MIA prima linea per le spedizioni dei sotto-master (null per le mie)
  const rows = (spedizioni || []).map((s: any) => {
    let master_rete: string | null = null
    if (s.master_id && s.master_id !== utente?.master_id) {
      const flId = primaLineaId.get(s.master_id)
      master_rete = flId ? (nomeMaster.get(flId) || null) : null
    }
    return { ...s, master_rete }
  })
  return NextResponse.json(rows)
}
