import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { creaCalcolatoreListinoCliente, creaCalcolatoreCorriere } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'

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
  const ruoloUtente = (utente?.ruolo || '').toLowerCase()
  // UN CLIENTE VEDE SOLO LE PROPRIE SPEDIZIONI, QUALUNQUE COSA CHIEDA.
  //
  // Il perimetro lo decideva il parametro ?clienteId. Passando "m:<id>" si finiva nel ramo della
  // rete, che per costruzione usa il client amministrativo e quindi SCAVALCA la RLS — e il
  // master_id ce l'hanno anche gli utenti cliente. Bastava quindi che un cliente chiamasse questa
  // rotta con l'id del proprio master per scaricarsi il report di tutte le spedizioni della rete,
  // costi nostri compresi. Il ruolo va guardato PRIMA di leggere qualunque parametro: quello che
  // arriva da fuori non puo' allargare il perimetro di chi chiede.
  const eCliente = ruoloUtente === 'cliente'
  const clienteIdRaw = eCliente ? null : p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato'); const dal = p.get('dal'); const al = p.get('al')
  const contrassegno = p.get('contrassegno'); const provincia = p.get('provincia')
  const ruolo = ruoloUtente
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
  if (masterSel && isMaster && mine) {
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
      .order('created_at', { ascending: false }).order('id', { ascending: false })
    if (subtreeSel) q = q.in('master_id', subtreeSel)
    else if (clienteId) q = q.eq('cliente_id', clienteId).eq('master_id', mine)
    else if (ruolo === 'cliente') q = q.eq('cliente_id', utente?.cliente_id)
    else if (reteIds && reteIds.length > 1) q = q.in('master_id', reteIds)
    else q = q.eq('master_id', mine)
    if (agIds) q = q.in('cliente_id', agIds)
    // Escludo le ANNULLATE (salvo filtro stato esplicito): sono rimborsate (addebito+rimborso = 0),
    // quindi il widget "Report Guadagno" (basato sui movimenti) le netta a 0. Contarle qui riga-per-riga
    // gonfiava i totali del report PDF e non coincideva col Guadagno. Ora report e Guadagno combaciano.
    if (!stato) q = q.not('stato', 'in', '(annullata)')
    if (stato) q = q.eq('stato', stato)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    if (contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (contrassegno === 'no') q = q.eq('contrassegno', 0)
    if (provincia) q = q.eq('dest_provincia', provincia)
    return q
  }
  // Report COMPLETO: carico a blocchi (il DB tronca a 1000/query), altrimenti i totali/margini
  // sarebbero sbagliati per i master con molte spedizioni. Nessun limite pratico.
  const spedizioni: any[] = await fetchAll(buildBase)

  // FONTE DI VERITÀ = i MOVIMENTI reali (quello che ogni livello ha effettivamente pagato).
  // Non ricalcolo i prezzi: un ricalcolo non replica agevolazioni misure/peso reale, fattore
  // per-corriere, ecc. e produce margini falsati. Uso gli importi realmente addebitati.
  const spedIds = (spedizioni || []).map((s: any) => s.id)
  const costoMine = new Map<string, number>()      // spedId -> costo del master loggato (mio)
  const costoTarget = new Map<string, number>()    // "spedId|masterId" -> costo di quel master
  const pagatoCliente = new Map<string, number>()  // spedId -> pagato dal cliente diretto
  const costoMinSped = new Map<string, number>()   // costo corriere REALE (movimento più profondo)
  // Chunk piccoli (300 id) + paginazione: ogni spedizione ha più movimenti (uno per livello) e un
  // chunk grande supererebbe le 1000 righe/query di PostgREST -> movimenti TRONCATI -> margini errati.
  // SOMMO 'spedizione' + 'rettifica' (signed): le rettifiche allineano il prezzo dopo una correzione.
  const sumCliR = new Map<string, number>()
  const sumTargetR = new Map<string, number>()
  const sumRettCli = new Map<string, number>()   // solo RETTIFICHE lato cliente (l'aumento/variazione di prezzo)
  for (let i = 0; i < spedIds.length; i += 300) {
    const chunk = spedIds.slice(i, i + 300)
    for (let from = 0; ; from += 1000) {
      // Movimenti via adminDb per TUTTI tranne il CLIENTE: all'agente serve per popolare
      // pagatoCliente (RLS gli bloccherebbe i movimenti) e non gli restituisco i costi master
      // (usa calcAgente per il costo). Per il CLIENTE resto su `db` (RLS): così i costi master
      // (costoMine) NON gli arrivano.
      const mvDb = ruolo === 'cliente' ? db : adminDb
      const { data: mvs } = await mvDb.from('movimenti')
        .select('spedizione_id,master_target_id,cliente_id,importo,tipo').in('tipo', ['spedizione', 'rettifica'])
        .in('spedizione_id', chunk).order('id', { ascending: true }).range(from, from + 999)
      if (!mvs?.length) break
      for (const mv of mvs) {
        const imp = Number(mv.importo || 0)   // SIGNED
        if (mv.cliente_id) {
          sumCliR.set(mv.spedizione_id, (sumCliR.get(mv.spedizione_id) || 0) + imp)
          if ((mv as any).tipo === 'rettifica') sumRettCli.set(mv.spedizione_id, (sumRettCli.get(mv.spedizione_id) || 0) + imp)
        }
        else if (mv.master_target_id) { const k = mv.spedizione_id + '|' + mv.master_target_id; sumTargetR.set(k, (sumTargetR.get(k) || 0) + imp) }
      }
      if (mvs.length < 1000) break
    }
  }
  for (const [spedId, s] of sumCliR) pagatoCliente.set(spedId, Math.round(Math.abs(s) * 100) / 100)
  for (const [k, s] of sumTargetR) {
    const [spedId, target] = k.split('|')
    const amt = Math.round(Math.abs(s) * 100) / 100
    costoTarget.set(k, amt)
    if (target === mine) costoMine.set(spedId, amt)
    const prev = costoMinSped.get(spedId)
    if (prev === undefined || amt < prev) costoMinSped.set(spedId, amt)
  }

  // AGENTE: il suo COSTO non è un movimento del master, ma il prezzo del suo LISTINO AGENTE.
  const calcAgente = isAgente(utente) && (utente as any)?.listino_agente_id
    ? await creaCalcolatoreListinoCliente(supabase, (utente as any).listino_agente_id)
    : null

  // Fallback prezzo corriere (movimento mancante su spedizioni vecchie/rete): il MIO listino corriere.
  let calcMioCorr: ((s: any) => any) | null = null
  const nomeToMioCorr = new Map<string, string>()
  if (isMaster && !calcAgente && spedIds.length) {
    try { calcMioCorr = await creaCalcolatoreCorriere(adminDb, mine as string) } catch { calcMioCorr = null }
    const { data: miei } = await adminDb.from('corrieri').select('id,nome_contratto').eq('master_id', mine)
    for (const c of (miei || [])) nomeToMioCorr.set((c as any).nome_contratto, (c as any).id)
  }

  // Prezzo cliente di RETE = prezzo del MIO listino verso il figlio di PRIMA LINEA (quello che gli ho
  // assegnato), stesso corriere rimappato per nome. Deterministico dai listini (identico all'Elenco).
  const parentListinoOf = new Map<string, string | null>()
  const calcPerListino = new Map<string, (s: any) => any>()
  if (isMaster && !calcAgente && primaLineaId.size) {
    const flIds = Array.from(new Set(Array.from(primaLineaId.values())))
    const { data: tms } = flIds.length ? await adminDb.from('masters').select('id,parent_listino_id').in('id', flIds) : { data: [] as any[] }
    for (const t of (tms || [])) parentListinoOf.set(t.id, (t as any).parent_listino_id || null)
    for (const lid of Array.from(new Set(Array.from(parentListinoOf.values()).filter(Boolean))) as string[]) calcPerListino.set(lid, await creaCalcolatoreListinoCliente(adminDb, lid))
  }

  // DATA CONSEGNA (colonna del report): per le spedizioni CONSEGNATE, la data_evento piu' recente dei
  // tracking_events (l'evento di consegna e' l'ultimo). Le non-consegnate restano senza data.
  const consegnaMap = new Map<string, string>()
  const deliveredIds = (spedizioni || []).filter((s: any) => /conseg/i.test(s.stato || '') && !/in[\s_]?conseg/i.test(s.stato || '')).map((s: any) => s.id)
  for (let i = 0; i < deliveredIds.length; i += 300) {
    const { data: ev } = await adminDb.from('tracking_events').select('spedizione_id,data_evento').in('spedizione_id', deliveredIds.slice(i, i + 300))
    for (const e of (ev || [])) {
      const d = (e as any).data_evento; if (!d) continue
      const p = consegnaMap.get((e as any).spedizione_id)
      if (!p || d > p) consegnaMap.set((e as any).spedizione_id, d)
    }
  }

  // DISTINTA (data + bordero) per le colonne Data_distinta/bda: NON esiste una FK spedizioni->distinte,
  // quindi NIENTE embed PostgREST `distinte(...)` (romperebbe TUTTA la query -> report vuoto). Lookup in
  // blocco per distinta_id.
  const distMap = new Map<string, any>()
  const distIds = Array.from(new Set((spedizioni || []).map((s: any) => s.distinta_id).filter(Boolean)))
  for (let i = 0; i < distIds.length; i += 300) {
    const { data: ds } = await adminDb.from('distinte').select('id,data,bordero_id').in('id', distIds.slice(i, i + 300))
    for (const d of (ds || [])) distMap.set((d as any).id, { data: (d as any).data, bordero_id: (d as any).bordero_id })
  }

  const rows = (spedizioni || []).map((s: any) => {
    // PREZZO CORRIERE = quello che ho pagato IO (mio movimento reale). Per l'agente = suo listino;
    // se il listino agente non copre quel corriere, ripiego sul costo reale (non 0, che gonfierebbe il margine).
    // AGENTE SENZA LISTINO ASSEGNATO: non ha un costo suo, e il ripiego finiva sul costo del
    // MASTER — che gli mostra il margine del master ed e' proprio il dato che non deve vedere.
    // Meglio nessun numero che un numero di qualcun altro.
    const agenteSenzaListino = isAgente(utente) && !calcAgente
    const hoMioCosto = !calcAgente && !agenteSenzaListino && costoMine.has(s.id)
    let prezzo_corriere: number | null = calcAgente
      ? (calcAgente(s)?.totale ?? (Number(s.costo_spedizione || 0) || null))
      : (hoMioCosto ? costoMine.get(s.id)! : null)
    if (prezzo_corriere == null && calcMioCorr && !calcAgente && !agenteSenzaListino) {
      const nome = (s.corrieri as any)?.nome_contratto
      const mioCorr = (s.master_id === mine) ? s.corriere_id : (nome ? nomeToMioCorr.get(nome) : null)
      if (mioCorr) { const r = calcMioCorr({ ...s, corriere_id: mioCorr }); if (r && r.totale != null) prezzo_corriere = r.totale }
    }
    // PREZZO CLIENTE = prezzo del LISTINO che HO ASSEGNATO al mio diretto:
    //  - mio cliente diretto -> quello che paga (costo_totale);
    //  - spedizione di rete -> prezzo del mio listino verso il figlio di PRIMA LINEA (diretto sotto di me).
    let prezzo_cliente: number
    if (calcAgente) {
      // Agente: prezzo cliente = quello che il cliente ha REALMENTE pagato (movimenti spedizione +
      // rettifica); fallback al campo costo_totale. Così le rettifiche valgono anche per l'agente.
      prezzo_cliente = pagatoCliente.has(s.id) ? pagatoCliente.get(s.id)! : Number(s.costo_totale || 0)
    } else if (s.master_id === mine) {
      prezzo_cliente = pagatoCliente.has(s.id) ? pagatoCliente.get(s.id)! : Number(s.costo_totale || 0)
    } else {
      // Rete: prezzo cliente = costo del figlio di PRIMA LINEA (quello che paga a me). Fallback:
      // il mio listino verso di lui; poi costo_totale.
      const flId = primaLineaId.get(s.master_id)
      if (flId && costoTarget.has(s.id + '|' + flId)) {
        prezzo_cliente = costoTarget.get(s.id + '|' + flId)!
      } else {
        const listinoId = flId ? parentListinoOf.get(flId) : null
        const nome = (s.corrieri as any)?.nome_contratto
        const mioCorr = nome ? nomeToMioCorr.get(nome) : null
        const calc = listinoId ? calcPerListino.get(listinoId) : null
        prezzo_cliente = Number(s.costo_totale || 0)
        if (calc && mioCorr) { const r = calc({ ...s, corriere_id: mioCorr }); if (r && r.totale != null) prezzo_cliente = r.totale }
      }
    }
    // NB: per i clienti di un AGENTE il master vede come "Prezzo Cliente" il prezzo del CLIENTE
    // FINALE (costo_totale), coerente col report Guadagno (che somma i movimenti cliente = costo_totale).
    // (Prima qui si sovrascriveva col listino agente: era incoerente col guadagno.)
    // Master SOPRA il proprietario del contratto (nessun mio costo né mio listino per quel corriere):
    // semplice passaggio -> prezzo corriere = prezzo cliente -> margine 0 (niente margine totale rete).
    if (prezzo_corriere == null && !calcAgente && !agenteSenzaListino) prezzo_corriere = prezzo_cliente
    if (eCliente) prezzo_corriere = prezzo_cliente
    // Rettifica lato cliente = variazione di prezzo applicata (positivo = aumento, es. +5€).
    const rettifica = Math.round((-(sumRettCli.get(s.id) || 0)) * 100) / 100
    // COSTO DEL MASTER FUORI DAL REPORT DELL'AGENTE. Lo spread `...s` porta con se' la colonna
    // grezza costo_spedizione, e cli_nolo la ricopiava di proposito: entrambe dicono quanto paga
    // il MASTER al corriere. Per l'agente il "Prezzo Corriere" e' il suo listino agente (calcAgente
    // qui sopra), non il costo del master — che e' esattamente il dato che il commento a inizio
    // rotta dichiara di non volergli dare.
    // Il costo del master non esce ne' verso l'agente ne' verso il CLIENTE: dice quanto paghiamo
    // noi al corriere, cioe' il margine. Per l'agente era gia' cosi'; per il cliente no, e la
    // colonna grezza usciva su tutte le spedizioni.
    const { costo_spedizione: _costoMaster, ...sPulita } = s
    const base = (calcAgente || agenteSenzaListino || eCliente) ? sPulita : s
    return {
      ...base,
      costo_totale: prezzo_cliente,          // "Prezzo Cliente" nel report (già comprensivo della rettifica)
      prezzo_corriere,                        // "Prezzo Corriere" (quello che pago io)
      rettifica,                              // colonna "Rettifica" (aumento/variazione di prezzo)
      data_consegna: consegnaMap.get(s.id) || null,   // colonna "Data_consegna" del report
      distinte: distMap.get(s.distinta_id) || null,   // { data, bordero_id } per Data_distinta/bda (lookup, non embed)
      dett_corriere: null,
      cli_nolo: calcAgente ? (prezzo_corriere ?? 0) : (eCliente ? 0 : Number(s.costo_spedizione || 0)),
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

  // I NOMI DELLE COLONNE SONO QUELLI VERI.
  // Qui si scriveva su utente_nome, stato e size: tre colonne che nella tabella non esistono (sono
  // utente, status e size_bytes). Ogni salvataggio finiva in errore 42703, e siccome le pagine non
  // guardano la risposta il master vedeva il file scaricarsi e poi non trovava nulla nell'elenco
  // dei report. E' questo il "non me li fa fare": il report si faceva, non si registrava.
  const { data: report, error } = await supabase.from('reports_generati').insert({
    master_id: utente?.master_id,
    tipo: body.tipo || 'spedizioni',
    formato: body.formato || 'pdf',
    filtri: typeof body.filtri === 'string' ? body.filtri : JSON.stringify(body.filtri || {}),
    utente: ((utente as any)?.nome || '').trim() || 'Utente',
    status: 'disponibile',
    size_bytes: null,
    created_by: user.id,
  }).select().single()

  if (error) {
    console.error('[REPORT] registrazione non riuscita:', error.message)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ id: report.id })
}
