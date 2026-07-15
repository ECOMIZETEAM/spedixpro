import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { creaCalcolatoreListinoCliente } from '@/lib/pricing'

// Report spedizioni dal punto di vista del MASTER LOGGATO (report margine):
// - "Tutti" (nessun cliente selezionato) → tutta la sua rete (sotto-albero).
// - Prezzo Cliente = quello che gli paga il suo DIRETTO (cliente diretto o figlio di prima linea).
// - Prezzo Corriere = quello che paga LUI (il suo listino corriere, assegnato dal master sopra).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome,listino_agente_id').eq('id', user.id).single()
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

  // Agente: solo i suoi clienti (calcolato una volta, fuori dal loop).
  const agIds = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  const buildBase = () => {
    let q = db.from('spedizioni')
      .select(`${SPED_COLS}, clienti(ragione_sociale,agente), corrieri(id,nome_contratto)`)
      .order('created_at', { ascending: false })
    if (subtreeSel) q = q.in('master_id', subtreeSel)
    else if (clienteId) q = q.eq('cliente_id', clienteId).eq('master_id', mine)
    else if (ruolo === 'cliente') q = q.eq('cliente_id', utente?.cliente_id)
    else if (reteIds && reteIds.length > 1) q = q.in('master_id', reteIds)
    else q = q.eq('master_id', mine)
    // Agente: escluse le annullate (rimborsate, margine 0) per coincidere con "Il mio guadagno".
    if (agIds) { q = q.in('cliente_id', agIds); if (!stato) q = q.not('stato', 'in', '(annullata)') }
    if (stato) q = q.eq('stato', stato)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    if (contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (contrassegno === 'no') q = q.eq('contrassegno', 0)
    if (provincia) q = q.eq('dest_provincia', provincia)
    return q
  }
  // Report COMPLETO: carico a blocchi (il DB tronca a 1000/query), altrimenti i totali/margini
  // sarebbero sbagliati per i master con molte spedizioni. Backstop a 20.000.
  const spedizioni: any[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data: batch } = await buildBase().range(from, from + 999)
    if (!batch?.length) break
    spedizioni.push(...batch)
    if (batch.length < 1000) break
  }

  // FONTE DI VERITÀ = i MOVIMENTI reali (quello che ogni livello ha effettivamente pagato).
  // Non ricalcolo i prezzi: un ricalcolo non replica agevolazioni misure/peso reale, fattore
  // per-corriere, ecc. e produce margini falsati. Uso gli importi realmente addebitati.
  const spedIds = (spedizioni || []).map((s: any) => s.id)
  const costoMine = new Map<string, number>()      // spedId -> costo del master loggato (mio)
  const costoTarget = new Map<string, number>()    // "spedId|masterId" -> costo di quel master
  const pagatoCliente = new Map<string, number>()  // spedId -> pagato dal cliente diretto
  for (let i = 0; i < spedIds.length; i += 500) {
    const chunk = spedIds.slice(i, i + 500)
    const { data: mvs } = await db.from('movimenti')
      .select('spedizione_id,master_target_id,cliente_id,importo').eq('tipo', 'spedizione').in('spedizione_id', chunk)
    for (const mv of (mvs || [])) {
      const imp = Math.abs(Number(mv.importo || 0))
      if (mv.cliente_id) pagatoCliente.set(mv.spedizione_id, imp)
      else if (mv.master_target_id) {
        if (mv.master_target_id === mine) costoMine.set(mv.spedizione_id, imp)
        costoTarget.set(mv.spedizione_id + '|' + mv.master_target_id, imp)
      }
    }
  }

  // AGENTE: il suo COSTO non è un movimento del master, ma il prezzo del suo LISTINO AGENTE.
  const calcAgente = isAgente(utente) && (utente as any)?.listino_agente_id
    ? await creaCalcolatoreListinoCliente(supabase, (utente as any).listino_agente_id)
    : null

  // MASTER: per i clienti che appartengono a un AGENTE con listino assegnato, il "prezzo cliente"
  // del master = il LISTINO AGENTE (quello che l'agente paga a ME), NON il prezzo del cliente finale.
  const clienteToListinoAg = new Map<string, string>()
  const calcListinoAg = new Map<string, (s: any) => any>()
  if (!calcAgente && isMaster) {
    const { data: agenti } = await adminDb.from('utenti').select('nome,cognome,listino_agente_id').eq('master_id', mine).eq('ruolo', 'agente').not('listino_agente_id', 'is', null)
    if (agenti?.length) {
      const nomeToListino = new Map<string, string>()
      for (const a of agenti) { const n = ((((a as any).nome) || '') + ' ' + (((a as any).cognome) || '')).trim(); if (n && (a as any).listino_agente_id) nomeToListino.set(n, (a as any).listino_agente_id) }
      const { data: cls } = await adminDb.from('clienti').select('id,agente').eq('master_id', mine).not('agente', 'is', null)
      for (const c of (cls || [])) { const lid = nomeToListino.get((((c as any).agente) || '').trim()); if (lid) clienteToListinoAg.set((c as any).id, lid) }
      for (const lid of Array.from(new Set(clienteToListinoAg.values()))) calcListinoAg.set(lid, await creaCalcolatoreListinoCliente(adminDb, lid))
    }
  }

  const rows = (spedizioni || []).map((s: any) => {
    // PREZZO CORRIERE = quello che ho pagato IO (mio movimento reale). Per l'agente = suo listino;
    // se il listino agente non copre quel corriere, ripiego sul costo reale (non 0, che gonfierebbe il margine).
    const prezzo_corriere: number | null = calcAgente
      ? (calcAgente(s)?.totale ?? (Number(s.costo_spedizione || 0) || null))
      : (costoMine.has(s.id) ? costoMine.get(s.id)! : null)
    // PREZZO CLIENTE = quello che mi paga il DIRETTO:
    //  - spedizione propria del mio cliente -> quello che ha pagato il cliente (suo movimento)
    //  - spedizione di rete -> quello che paga il figlio di prima linea (suo movimento)
    let prezzo_cliente: number
    if (calcAgente) {
      // Agente: costo cliente = quello che paga il cliente (costo_totale), come nella dashboard.
      prezzo_cliente = Number(s.costo_totale || 0)
    } else if (s.master_id === mine) {
      prezzo_cliente = pagatoCliente.has(s.id) ? pagatoCliente.get(s.id)! : Number(s.costo_totale || 0)
    } else {
      const flId = primaLineaId.get(s.master_id)
      prezzo_cliente = (flId && costoTarget.has(s.id + '|' + flId)) ? costoTarget.get(s.id + '|' + flId)! : Number(s.costo_totale || 0)
    }
    // Cliente di un AGENTE: verso il master il prezzo è quello del listino agente (non del cliente finale).
    if (!calcAgente && s.cliente_id && clienteToListinoAg.has(s.cliente_id)) {
      const p = calcListinoAg.get(clienteToListinoAg.get(s.cliente_id)!)?.(s)
      if (p && p.totale != null) prezzo_cliente = p.totale
    }
    return {
      ...s,
      costo_totale: prezzo_cliente,          // "Prezzo Cliente" nel report
      prezzo_corriere,                        // "Prezzo Corriere" (quello che pago io)
      dett_corriere: null,
      cli_nolo: Number(s.costo_spedizione || 0),
      cli_supplementi: 0,
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
