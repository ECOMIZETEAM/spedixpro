import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

// Report spedizioni dal punto di vista del MASTER LOGGATO (report margine):
// - "Tutti" (nessun cliente selezionato) → tutta la sua rete (sotto-albero).
// - Prezzo Cliente = quello che gli paga il suo DIRETTO (cliente diretto o figlio di prima linea).
// - Prezzo Corriere = quello che paga LUI (il suo listino corriere, assegnato dal master sopra).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
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
  // Agente: solo le spedizioni dei suoi clienti.
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  if (provincia) query = query.eq('dest_provincia', provincia)
  const { data: spedizioni } = await query

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

  const rows = (spedizioni || []).map((s: any) => {
    // PREZZO CORRIERE = quello che ho pagato IO (mio movimento reale)
    const prezzo_corriere: number | null = costoMine.has(s.id) ? costoMine.get(s.id)! : null
    // PREZZO CLIENTE = quello che mi paga il DIRETTO:
    //  - spedizione propria del mio cliente -> quello che ha pagato il cliente (suo movimento)
    //  - spedizione di rete -> quello che paga il figlio di prima linea (suo movimento)
    let prezzo_cliente: number
    if (s.master_id === mine) {
      prezzo_cliente = pagatoCliente.has(s.id) ? pagatoCliente.get(s.id)! : Number(s.costo_totale || 0)
    } else {
      const flId = primaLineaId.get(s.master_id)
      prezzo_cliente = (flId && costoTarget.has(s.id + '|' + flId)) ? costoTarget.get(s.id + '|' + flId)! : Number(s.costo_totale || 0)
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
