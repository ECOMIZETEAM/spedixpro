import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { creaCalcolatoreCorriere, creaCalcolatoreListinoCliente } from '@/lib/pricing'
import { SPED_COLS } from '@/lib/spedizioni-cols'

// Report spedizioni dal punto di vista del MASTER LOGGATO (report margine):
// - "Tutti" (nessun cliente selezionato) → tutta la sua rete (sotto-albero).
// - Prezzo Cliente = quello che gli paga il suo DIRETTO (cliente diretto o figlio di prima linea).
// - Prezzo Corriere = quello che paga LUI (il suo listino corriere, assegnato dal master sopra).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato'); const dal = p.get('dal'); const al = p.get('al')
  const contrassegno = p.get('contrassegno'); const provincia = p.get('provincia')
  const ruolo = (utente?.ruolo || '').toLowerCase()
  const mine = utente?.master_id
  const isMaster = ruolo !== 'cliente' && ruolo !== 'agente' && !!mine

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminDb = createAdminSupabase()

  // Prima linea: per ogni discendente del master loggato, il figlio diretto attraverso cui
  // scende la spedizione (serve per prezzare il PREZZO CLIENTE verso il figlio diretto).
  const primaLineaId = new Map<string, string>()
  if (isMaster && mine) {
    let frontier = [mine]
    for (let i = 0; i < 12 && frontier.length; i++) {
      const { data: figli } = await adminDb.from('masters').select('id,parent_master_id').in('parent_master_id', frontier)
      const nuovi: string[] = []
      for (const c of (figli || [])) {
        if (primaLineaId.has(c.id) || c.id === mine) continue
        primaLineaId.set(c.id, c.parent_master_id === mine ? c.id : (primaLineaId.get(c.parent_master_id) || c.id))
        nuovi.push(c.id)
      }
      frontier = nuovi
    }
  }

  // Scope della query
  let db: any = supabase
  let subtreeSel: string[] | null = null
  if (masterSel && mine) {
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const mieiDiscendenti = await masterIdsVisibili(adminDb, mine)
    subtreeSel = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(adminDb, masterSel) : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  }
  const reteIds = isMaster && !clienteId && !masterSel ? [mine as string, ...primaLineaId.keys()] : null
  if (reteIds && reteIds.length > 1) db = adminDb

  let query = db.from('spedizioni')
    .select(`${SPED_COLS}, clienti(ragione_sociale,agente), corrieri(id,nome_contratto)`)
    .order('created_at', { ascending: false }).limit(5000)
  if (subtreeSel) query = query.in('master_id', subtreeSel)
  else if (clienteId) query = query.eq('cliente_id', clienteId).eq('master_id', mine)
  else if (ruolo === 'cliente') query = query.eq('cliente_id', utente?.cliente_id)
  else if (reteIds && reteIds.length > 1) query = query.in('master_id', reteIds)
  else query = query.eq('master_id', mine)
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  if (provincia) query = query.eq('dest_provincia', provincia)
  const { data: spedizioni } = await query

  // Calcolatori dal punto di vista del MASTER LOGGATO
  const nomeToMioCorr = new Map<string, string>()   // nome contratto -> mio corriere id
  const { data: mieiCorr } = mine ? await db.from('corrieri').select('id,nome_contratto').eq('master_id', mine) : { data: [] }
  for (const c of (mieiCorr || [])) nomeToMioCorr.set((c.nome_contratto || '').trim().toLowerCase(), c.id)
  const calcMioCorriere = mine ? await creaCalcolatoreCorriere(db, mine) : null

  // Prezzo cliente per le spedizioni di rete = mio listino cliente verso il figlio diretto (prima linea)
  const parentListinoOf = new Map<string, string | null>()   // figlio diretto -> parent_listino_id
  const calcPerListino = new Map<string, (s: any) => any>()
  const targetIds = new Set<string>(primaLineaId.values())
  if (targetIds.size && (spedizioni || []).length) {
    const { data: tms } = await db.from('masters').select('id,parent_listino_id').in('id', Array.from(targetIds))
    for (const t of (tms || [])) parentListinoOf.set(t.id, (t as any).parent_listino_id || null)
    const listini = Array.from(new Set(Array.from(parentListinoOf.values()).filter(Boolean))) as string[]
    for (const lid of listini) calcPerListino.set(lid, await creaCalcolatoreListinoCliente(db, lid))
  }

  const rows = (spedizioni || []).map((s: any) => {
    const nome = ((s.corrieri as any)?.nome_contratto || '').trim().toLowerCase()
    const mioCorr = nomeToMioCorr.get(nome) || (s.master_id === mine ? s.corriere_id : null)

    // PREZZO CORRIERE = il MIO listino corriere per quel contratto (quello che pago io)
    let prezzo_corriere: number | null = null
    let dett_corriere: any = null
    if (mioCorr && calcMioCorriere) {
      const d = calcMioCorriere({ ...s, corriere_id: mioCorr })
      if (d) { prezzo_corriere = d.totale; dett_corriere = d }
    }

    // PREZZO CLIENTE = quello che mi paga il DIRETTO
    // - spedizione propria: il prezzo del cliente diretto (costo_totale salvato)
    // - spedizione di rete: il prezzo del MIO listino cliente verso il figlio diretto
    let prezzo_cliente = Number(s.costo_totale || 0)
    if (s.master_id !== mine) {
      const flId = primaLineaId.get(s.master_id)
      const listinoId = flId ? parentListinoOf.get(flId) : null
      const calc = listinoId ? calcPerListino.get(listinoId) : null
      if (calc && mioCorr) { const ris = calc({ ...s, corriere_id: mioCorr }); if (ris && ris.totale != null) prezzo_cliente = ris.totale }
    }

    return {
      ...s,
      costo_totale: prezzo_cliente,          // "Prezzo Cliente" nel report
      prezzo_corriere,                        // "Prezzo Corriere" (mio listino corriere)
      dett_corriere,
      cli_nolo: Number(s.costo_spedizione || 0),
      cli_supplementi: Math.max(0, Math.round((prezzo_cliente - Number(s.costo_spedizione || 0)) * 100) / 100),
    }
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,nome').eq('id', user.id).single()
  const body = await req.json()

  const { data: report, error } = await supabase.from('reports_generati').insert({
    master_id: utente?.master_id,
    tipo: 'spedizioni',
    formato: body.formato || 'pdf',
    filtri: body.filtri || {},
    utente_nome: (utente as any)?.nome || 'Admin',
    stato: 'disponibile',
    size: null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ id: report.id })
}
