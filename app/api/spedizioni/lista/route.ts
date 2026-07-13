import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { creaCalcolatoreListinoCliente } from '@/lib/pricing'
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
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = selezione di un sotto-master agganciato (trattato come cliente)
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
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
  const isMasterRete = ruolo !== 'cliente' && ruolo !== 'agente' && !clienteIdRaw && agenteClienteIds === null
  let db: any = supabase
  let masterIds: string[] | null = null
  let subtreeSel: string[] | null = null  // sotto-albero del sotto-master selezionato

  // Selezione di un sotto-master agganciato: mostro le spedizioni del suo sotto-albero
  if (masterSel && ruolo !== 'cliente' && ruolo !== 'agente' && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)   // solo se privilegiato include i figli
    if (mieiDiscendenti.includes(masterSel)) {   // autorizzazione: dev'essere un mio discendente
      subtreeSel = await sottoAlberoMasterIds(adminDb, masterSel)
      db = adminDb
    } else {
      subtreeSel = ['00000000-0000-0000-0000-000000000000']  // non autorizzato -> vuoto
    }
  }
  const primaLineaId = new Map<string, string>()  // master discendente -> id del figlio diretto (prima linea)
  const nomeMaster = new Map<string, string>()     // master id -> nome
  if (isMasterRete && utente?.master_id) {
    const mine = utente.master_id
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminDb = createAdminSupabase()
    masterIds = [mine]
    // La volumetria della rete sotto un master risale sempre a lui (tutti i livelli).
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
  let query = db.from('spedizioni').select(`${SPED_COLS},clienti(ragione_sociale,agente),corrieri(id,nome_contratto)`).order(ordinaPer, { ascending: false }).limit(200)
  if (subtreeSel) {
    query = query.in('master_id', subtreeSel)
  } else if (clienteId) {
    query = query.eq('cliente_id', clienteId).eq('master_id', utente?.master_id)
  } else if (utente?.ruolo === 'cliente') {
    query = query.eq('cliente_id', utente.cliente_id)
  } else if (masterIds && masterIds.length > 1) {
    query = query.in('master_id', masterIds)
  } else {
    query = query.eq('master_id', utente?.master_id)
  }
  // Filtro stato: se richiesto uno stato preciso lo applico; se non richiesto, mostro anche le
  // spedizioni in annullamento_pending (restano in elenco, ripristinabili, finché non diventano
  // annullate definitive). Escludo solo le annullate e la coda manuale (che vivono in "Cancellate").
  if (stato && stato !== 'tutti') query = query.eq('stato', stato)
  else query = query.not('stato', 'in', '(annullata,annullamento_manuale)')
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

  // Costo da mostrare = il PREZZO CLIENTE che ti paga il tuo DIRETTO:
  // - spedizione propria (master_id = io): il prezzo del cliente diretto (costo_totale).
  // - spedizione della rete: il prezzo del MIO listino cliente verso il figlio diretto
  //   (prima linea), per quel corriere = quello che lui paga a me.
  const parentListinoOf = new Map<string, string | null>()  // figlio diretto -> parent_listino_id
  const nomeToMioCorr = new Map<string, string>()            // nome contratto -> mio corriere id
  const calcPerListino = new Map<string, (s: any) => any>()  // listino_id -> calcolatore batch
  const targetIds = new Set<string>()
  for (const fl of primaLineaId.values()) targetIds.add(fl)
  if (isMasterRete && targetIds.size && (spedizioni || []).length) {
    const { data: tms } = await db.from('masters').select('id,parent_listino_id').in('id', Array.from(targetIds))
    for (const t of (tms || [])) parentListinoOf.set(t.id, (t as any).parent_listino_id || null)
    const { data: miei } = await db.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
    for (const c of (miei || [])) nomeToMioCorr.set(c.nome_contratto, c.id)
    const listini = Array.from(new Set(Array.from(parentListinoOf.values()).filter(Boolean))) as string[]
    for (const lid of listini) calcPerListino.set(lid, await creaCalcolatoreListinoCliente(db, lid))
  }

  // master_rete = nome della MIA prima linea per le spedizioni dei sotto-master (null per le mie)
  const rows = (spedizioni || []).map((s: any) => {
    let master_rete: string | null = null
    let master_rete_id: string | null = null
    if (masterSel) {
      // Vista filtrata su un sotto-master: la prima linea sono io -> il sotto-master selezionato
      master_rete_id = masterSel
    } else if (s.master_id && s.master_id !== utente?.master_id) {
      const flId = primaLineaId.get(s.master_id)
      master_rete = flId ? (nomeMaster.get(flId) || null) : null
      master_rete_id = flId || null
    }
    // Sulle spedizioni di rete: prezzo del mio listino cliente verso il figlio diretto (prima
    // linea) per quel corriere. Sulle mie spedizioni resta il prezzo del cliente (costo_totale).
    let costo_mostrato = Number(s.costo_totale || 0)
    if (!masterSel && master_rete_id) {
      const listinoId = parentListinoOf.get(master_rete_id)
      const nome = (s.corrieri as any)?.nome_contratto
      const mioCorr = nome ? nomeToMioCorr.get(nome) : null
      const calc = listinoId ? calcPerListino.get(listinoId) : null
      if (calc && mioCorr) {
        const ris = calc({ ...s, corriere_id: mioCorr })
        if (ris && ris.totale != null) costo_mostrato = ris.totale
      }
    }
    return { ...s, master_rete, master_rete_id, costo_mostrato }
  })
  return NextResponse.json(rows)
}
