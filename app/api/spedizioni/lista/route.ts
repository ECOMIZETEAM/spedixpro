import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { creaCalcolatoreListinoCliente, creaCalcolatoreCorriere } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'
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

  // ── PAGINAZIONE SERVER-SIDE (con ?page=N): risposta { rows, total, page, perPage } e TUTTI i
  //    filtri applicati a DB → viaggiano solo le righe della pagina (10), non l'intero periodo.
  //    SENZA ?page il comportamento resta IDENTICO a prima (array completo) per le altre pagine.
  const pageParam = parseInt(p.get('page') || '')
  const paged = Number.isFinite(pageParam) && pageParam > 0
  const perPage = Math.min(200, Math.max(1, parseInt(p.get('perPage') || '') || 10))
  const fContratto = p.get('contratto')
  const fVettore = p.get('vettore')
  const fNegozio = p.get('negozio')
  const fAgente = p.get('agente')
  const fIdOrdine = p.get('id_ordine')
  const fStatoContr = p.get('stato_contrassegni')
  const fAssic = p.get('assicurazione')
  const fFatt = p.get('fatturato')
  const fCerca = p.get('cerca')
  // Selezione RETE/CLIENTE in modalità paginata: parametri DEDICATI che NON sostituiscono lo scope
  // di rete (così prezzi/margini per prima-linea restano identici a prima, quando il filtro era in
  // memoria sul browser sopra le righe già arricchite).
  const fRete = p.get('rete')            // id sotto-master di prima linea: filtra al suo sotto-albero
  const fClienteEq = p.get('clienteEq')  // id cliente esatto: filtro AND dentro lo scope di rete
  // Ricerca ID ORDINE: l'id reale sta in ordini_importati/ordini_ecommerce → risolvo prima gli id
  // spedizione che matchano, poi filtro (più i campi diretti id_ordine_esterno/rif_ordine).
  const sanitizza = (v: string) => v.replace(/[,()"\\%]/g, ' ').trim()
  let idOrdineSpedIds: string[] = []
  if (fIdOrdine) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminIO = createAdminSupabase()
    const cIO = sanitizza(fIdOrdine)
    const [a, b] = await Promise.all([
      adminIO.from('ordini_importati').select('spedizione_id').ilike('order_id', `%${cIO}%`).not('spedizione_id', 'is', null).limit(200),
      adminIO.from('ordini_ecommerce').select('spedizione_id').or(`numero_ordine.ilike.%${cIO}%,ordine_esterno_id.ilike.%${cIO}%`).not('spedizione_id', 'is', null).limit(200),
    ])
    idOrdineSpedIds = Array.from(new Set([...(a.data || []), ...(b.data || [])].map((r: any) => r.spedizione_id).filter(Boolean)))
  }

  // ── Rete: un master vede anche le spedizioni dei sotto-master (tutta la discendenza),
  //    ma etichettate con la PROPRIA PRIMA LINEA (il figlio diretto attraverso cui
  //    discende la spedizione). Es: io->MASSIMO->GIOVANNI: le spedizioni di Giovanni
  //    le vedo sotto "MASSIMO" (la mia prima linea). ──
  const ruolo = (utente?.ruolo || '').toLowerCase()
  const isMasterRete = ruolo !== 'cliente' && ruolo !== 'agente' && !clienteIdRaw && agenteClienteIds === null
  let db: any = supabase
  let masterIds: string[] | null = null
  let subtreeSel: string[] | null = null  // sotto-albero del sotto-master selezionato
  let reteSubtree: string[] | null = null // filtro rete (paginato): sotto-albero DENTRO la mia rete

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
    // UNA sola query sui masters (tabella piccola) invece di una per livello: il BFS resta identico.
    const { data: tuttiM } = await adminDb.from('masters').select('id,nome,parent_master_id')
    const figliDi = new Map<string, any[]>()
    for (const m of (tuttiM || [])) {
      const p = (m as any).parent_master_id
      if (!p) continue
      if (!figliDi.has(p)) figliDi.set(p, [])
      figliDi.get(p)!.push(m)
    }
    let frontier = [mine]
    for (let i = 0; i < 20 && frontier.length; i++) {
      const nuovi: string[] = []
      for (const f of frontier) for (const c of (figliDi.get(f) || [])) {
        if (masterIds.includes(c.id)) continue
        nomeMaster.set(c.id, c.nome)
        // prima linea = il figlio diretto se il padre sono io, altrimenti eredita quella del padre
        primaLineaId.set(c.id, c.parent_master_id === mine ? c.id : (primaLineaId.get(c.parent_master_id) || c.id))
        masterIds.push(c.id); nuovi.push(c.id)
      }
      frontier = nuovi
    }
    if (masterIds.length > 1) db = adminDb  // servono i permessi cross-master (RLS)
    // Filtro RETE (paginato): restringo al sotto-albero del sotto-master selezionato, MANTENENDO
    // l'arricchimento di rete (prima linea/prezzi) — dev'essere un master della mia rete.
    if (fRete && masterIds.includes(fRete)) {
      reteSubtree = [fRete]
      let fr = [fRete]
      for (let i = 0; i < 20 && fr.length; i++) {
        const nu: string[] = []
        for (const f of fr) for (const c of (figliDi.get(f) || [])) {
          if (!reteSubtree.includes(c.id)) { reteSubtree.push(c.id); nu.push(c.id) }
        }
        fr = nu
      }
    }
  }

  // Solo colonne leggere (SPED_COLS): esclusi etichetta_url/raw_response/colli_dettaglio.
  // Costruisco una query FRESCA a ogni chiamata (i builder Supabase sono monouso).
  const buildBase = (contaTotale = false) => {
    // 2° ordinamento su 'id' (tie-breaker DETERMINISTICO): senza, le righe con lo stesso valore di
    // ordinaPer (es. created_at identico negli import in blocco) cambiano posizione tra le pagine
    // (fetchAll >1000) → l'elenco "balla". Con l'id la paginazione è stabile e completa.
    // I filtri su tabelle collegate (contratto/vettore → corrieri, agente → clienti) richiedono il
    // join !inner: attivato SOLO quando quel filtro è presente (altrimenti embed normale, invariato).
    const embCorr = (fContratto || fVettore) ? 'corrieri!inner(id,nome_contratto)' : 'corrieri(id,nome_contratto)'
    const embCli = fAgente ? 'clienti!inner(ragione_sociale,agente)' : 'clienti(ragione_sociale,agente)'
    let q = db.from('spedizioni').select(`${SPED_COLS},${embCli},${embCorr}`, contaTotale ? { count: 'exact' } : undefined).order(ordinaPer, { ascending: false }).order('id', { ascending: false })
    if (subtreeSel) q = q.in('master_id', subtreeSel)
    else if (clienteId) q = q.eq('cliente_id', clienteId).eq('master_id', utente?.master_id)
    else if (utente?.ruolo === 'cliente') q = q.eq('cliente_id', utente.cliente_id)
    else if (reteSubtree) q = q.in('master_id', reteSubtree)
    else if (masterIds && masterIds.length > 1) q = q.in('master_id', masterIds)
    else q = q.eq('master_id', utente?.master_id)
    if (fClienteEq) q = q.eq('cliente_id', fClienteEq)
    // Filtro stato: se richiesto uno stato preciso lo applico; se non richiesto, mostro anche le
    // spedizioni in annullamento_pending (ripristinabili). Escludo solo annullate e coda manuale.
    if (stato && stato !== 'tutti') q = q.eq('stato', stato)
    else q = q.not('stato', 'in', '(annullata,annullamento_manuale)')
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    if (numero) q = q.ilike('numero', `%${numero}%`)
    if (destCitta) q = q.ilike('dest_citta', `%${destCitta}%`)
    if (destCap) q = q.ilike('dest_cap', `%${destCap}%`)
    if (contenuto) q = q.ilike('contenuto', `%${contenuto}%`)
    if (contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (contrassegno === 'no') q = q.eq('contrassegno', 0)
    if (agenteClienteIds !== null) q = q.in('cliente_id', agenteClienteIds.length ? agenteClienteIds : ['00000000-0000-0000-0000-000000000000'])
    // ── Filtri aggiuntivi (prima applicati in memoria dal browser; identica semantica) ──
    if (fContratto) q = q.eq('corrieri.nome_contratto', fContratto)
    if (fVettore) q = q.ilike('corrieri.nome_contratto', `${sanitizza(fVettore)}%`)
    if (fNegozio) q = q.eq('canale', fNegozio)
    if (fAgente) q = q.eq('clienti.agente', fAgente)
    if (fStatoContr === 'da_pagare') q = q.gt('contrassegno', 0).or('stato_contrassegno.is.null,and(stato_contrassegno.neq.in_distinta,stato_contrassegno.neq.pagato)')
    if (fStatoContr === 'in_attesa') q = q.eq('stato_contrassegno', 'in_distinta')
    if (fStatoContr === 'pagato') q = q.eq('stato_contrassegno', 'pagato')
    if (fAssic === 'si') q = q.gt('assicurazione', 0)
    if (fAssic === 'no') q = q.or('assicurazione.is.null,assicurazione.eq.0')
    if (fFatt === 'si') q = q.eq('fatturato', true)
    if (fFatt === 'no') q = q.or('fatturato.is.null,fatturato.eq.false')
    if (fCerca) { const c = sanitizza(fCerca); if (c) q = q.or(`numero.ilike.%${c}%,dest_nome.ilike.%${c}%,mitt_nome.ilike.%${c}%,tracking_number.ilike.%${c}%`) }
    if (fIdOrdine) {
      const c = sanitizza(fIdOrdine)
      const inIds = idOrdineSpedIds.length ? `id.in.(${idOrdineSpedIds.join(',')}),` : ''
      q = q.or(`${inIds}id_ordine_esterno.ilike.%${c}%,rif_ordine.ilike.%${c}%`)
    }
    return q
  }
  // PAGINATO: solo la pagina richiesta + conteggio totale. LEGACY (senza ?page): tutte le righe
  // a blocchi (PostgREST tronca a 1000/query) come prima, per le pagine che si aspettano l'array.
  let totalePaginato = 0
  let spedizioni: any[]
  if (paged) {
    const from = (pageParam - 1) * perPage
    const { data, count } = await buildBase(true).range(from, from + perPage - 1)
    spedizioni = data || []
    totalePaginato = count || 0
  } else {
    spedizioni = await fetchAll(buildBase)
  }

  // Costo da mostrare = il PREZZO CLIENTE che ti paga il tuo DIRETTO:
  // - spedizione propria (master_id = io): il prezzo del cliente diretto (costo_totale).
  // - spedizione della rete: il prezzo del MIO listino cliente verso il figlio diretto
  //   (prima linea), per quel corriere = quello che lui paga a me.
  const parentListinoOf = new Map<string, string | null>()  // figlio diretto -> parent_listino_id
  const nomeToMioCorr = new Map<string, string>()            // nome contratto -> mio corriere id
  const calcPerListino = new Map<string, (s: any) => any>()  // listino_id -> calcolatore batch
  const targetIds = new Set<string>()
  for (const fl of primaLineaId.values()) targetIds.add(fl)
  // NB: i calcolatori (fasce/zone/CAP) si costruiscono PIÙ SOTTO e SOLO SE servono: sono il
  // FALLBACK per le righe senza movimento reale. Prima si costruivano sempre (query pesanti a
  // ogni apertura) anche quando tutte le righe avevano già i prezzi dai movimenti.

  // Prezzi REALI dai MOVIMENTI (solo master): "quello che pago io" (mio movimento) e "quello che mi
  // paga il diretto"; il margine e' la differenza. Non per cliente/agente.
  const mineId = utente?.master_id
  const costoMine = new Map<string, number>()
  const costoTarget = new Map<string, number>()
  const pagatoCliente = new Map<string, number>()
  const costoMinSped = new Map<string, number>()   // costo corriere REALE = movimento più profondo (min)
  const caricaMovimenti = async () => {
    if (!(mineId && ruolo !== 'cliente' && ruolo !== 'agente' && (spedizioni || []).length)) return
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminMov = createAdminSupabase()
    const spedIds = (spedizioni || []).map((s: any) => s.id)
    // SOMMO gli importi SIGNED di 'spedizione' + 'rettifica' (le rettifiche allineano il prezzo dopo
    // una correzione: es. sotto costo). Charge = negativo, credito = positivo. Il totale addebitato è
    // -(somma). Prima si leggeva solo 'spedizione' e si sovrascriveva -> le rettifiche non si vedevano.
    const sumCli = new Map<string, number>()      // spedId -> somma signed (movimenti cliente)
    const sumTarget = new Map<string, number>()   // spedId|target -> somma signed (movimenti master)
    // Chunk in PARALLELO (prima in sequenza: con migliaia di spedizioni erano decine di round-trip
    // uno dietro l'altro = lista lenta). L'aggregazione è una somma: l'ordine non conta.
    const chunksMov: string[][] = []
    for (let i = 0; i < spedIds.length; i += 300) chunksMov.push(spedIds.slice(i, i + 300))
    await Promise.all(chunksMov.map(async (chunk) => {
      for (let from = 0; ; from += 1000) {
        const { data: mvs } = await adminMov.from('movimenti')
          .select('spedizione_id,master_target_id,cliente_id,importo').in('tipo', ['spedizione', 'rettifica'])
          .in('spedizione_id', chunk).order('id', { ascending: true }).range(from, from + 999)
        if (!mvs?.length) break
        for (const mv of mvs) {
          const imp = Number(mv.importo || 0)   // SIGNED
          if (mv.cliente_id) sumCli.set(mv.spedizione_id, (sumCli.get(mv.spedizione_id) || 0) + imp)
          else if (mv.master_target_id) { const k = mv.spedizione_id + '|' + mv.master_target_id; sumTarget.set(k, (sumTarget.get(k) || 0) + imp) }
        }
        if (mvs.length < 1000) break
      }
    }))
    for (const [spedId, s] of sumCli) pagatoCliente.set(spedId, Math.round(Math.abs(s) * 100) / 100)
    for (const [k, s] of sumTarget) {
      const [spedId, target] = k.split('|')
      const amt = Math.round(Math.abs(s) * 100) / 100
      costoTarget.set(k, amt)
      if (target === mineId) costoMine.set(spedId, amt)
      const prev = costoMinSped.get(spedId)
      if (prev === undefined || amt < prev) costoMinSped.set(spedId, amt)
    }
  }

  // ID ORDINE reale = quello dell'ordine COLLEGATO: da CSV (ordini_importati.order_id) o dalle
  // integrazioni (ordini_ecommerce.numero_ordine / ordine_esterno_id). Le colonne
  // spedizioni.id_ordine_esterno/rif_ordine non sono popolate, quindi prima si mostrava la nota.
  const idOrdine = new Map<string, string>()
  const caricaIdOrdine = async () => {
    if (!(spedizioni || []).length) return
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminOrd = createAdminSupabase()
    const ids = (spedizioni || []).map((s: any) => s.id)
    // Chunk in PARALLELO (ogni spedizione sta in UN solo chunk → il "primo vince" resta identico;
    // dentro al chunk l'ordine CSV-prima-di-ecommerce è preservato).
    const chunksOrd: string[][] = []
    for (let i = 0; i < ids.length; i += 300) chunksOrd.push(ids.slice(i, i + 300))
    await Promise.all(chunksOrd.map(async (chunk) => {
      for (let from = 0; ; from += 1000) {
        const { data: imp } = await adminOrd.from('ordini_importati').select('spedizione_id,order_id').in('spedizione_id', chunk).not('order_id', 'is', null).order('id', { ascending: true }).range(from, from + 999)
        for (const o of (imp || [])) { const sid = (o as any).spedizione_id, v = (o as any).order_id; if (sid && v && !idOrdine.has(sid)) idOrdine.set(sid, String(v)) }
        if (!imp?.length || imp.length < 1000) break
      }
      const { data: ecom } = await adminOrd.from('ordini_ecommerce').select('spedizione_id,numero_ordine,ordine_esterno_id').in('spedizione_id', chunk)
      for (const o of (ecom || [])) { const sid = (o as any).spedizione_id, v = (o as any).numero_ordine || (o as any).ordine_esterno_id; if (sid && v && !idOrdine.has(sid)) idOrdine.set(sid, String(v)) }
    }))
  }

  // Numero DISTINTA RESI per le spedizioni in "reso al mittente" (mostrato sotto lo stato in elenco:
  // segnala che il reso è già stato scansionato/addebitato e chiuso in distinta). voci è JSON → mappo.
  const distintaReso = new Map<string, number>()
  const spedReso = (spedizioni || []).filter((s: any) => s.stato === 'reso_mittente')
  const caricaResi = async () => {
    if (!spedReso.length) return
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminR = createAdminSupabase()
    const mastersDelleSped = Array.from(new Set((spedizioni || []).map((s: any) => s.master_id).filter(Boolean)))
    if (mastersDelleSped.length) {
      const { data: dr } = await adminR.from('distinte_resi').select('numero,voci').in('master_id', mastersDelleSped)
      for (const d of (dr || [])) for (const v of (((d as any).voci) || [])) if (v?.id) distintaReso.set(v.id, (d as any).numero)
    }
  }

  // I tre blocchi di arricchimento sono INDIPENDENTI tra loro → girano in PARALLELO (prima in serie).
  await Promise.all([caricaMovimenti(), caricaIdOrdine(), caricaResi()])

  // Fallback PIGRI (DOPO i movimenti: dipendono dai prezzi reali): i calcolatori listino (query
  // pesanti su fasce/zone) si costruiscono SOLO se esiste almeno una riga senza prezzo reale.
  // 1) Listino cliente verso la prima linea: serve alle righe di RETE senza movimento del diretto.
  const serveListinoFallback = isMasterRete && targetIds.size && (spedizioni || []).some((s: any) => {
    if (!s.master_id || s.master_id === mineId) return false
    const fl = primaLineaId.get(s.master_id)
    return !!fl && !costoTarget.has(s.id + '|' + fl)
  })
  if (serveListinoFallback) {
    const { data: tms } = await db.from('masters').select('id,parent_listino_id').in('id', Array.from(targetIds))
    for (const t of (tms || [])) parentListinoOf.set(t.id, (t as any).parent_listino_id || null)
    const { data: miei } = await db.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
    for (const c of (miei || [])) nomeToMioCorr.set(c.nome_contratto, c.id)
    const listini = Array.from(new Set(Array.from(parentListinoOf.values()).filter(Boolean))) as string[]
    for (const lid of listini) calcPerListino.set(lid, await creaCalcolatoreListinoCliente(db, lid))
  }
  // 2) Fallback PREZZO CORRIERE quando manca il MIO movimento (spedizioni vecchie / rete non
  //    tracciata): calcolo il MIO listino corriere. Per le spedizioni di rete il corriere è del
  //    sotto-master -> lo rimappo al MIO corriere con lo stesso nome_contratto.
  let calcMioCorr: ((s: any) => any) | null = null
  if (mineId && ruolo !== 'cliente' && ruolo !== 'agente' && (spedizioni || []).some((s: any) => !costoMine.has(s.id))) {
    try { calcMioCorr = await creaCalcolatoreCorriere(db, mineId) } catch { calcMioCorr = null }
    if (!nomeToMioCorr.size) {
      const { data: miei } = await db.from('corrieri').select('id,nome_contratto').eq('master_id', mineId)
      for (const c of (miei || [])) nomeToMioCorr.set((c as any).nome_contratto, (c as any).id)
    }
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
    // PREZZO CLIENTE = quello che mi paga il mio DIRETTO (figlio di PRIMA LINEA sotto di me), MAI il
    // livello finale. Fonte = il costo del figlio di prima linea (quello che ha pagato = quello che
    // paga a me). Fallback: il mio listino verso di lui (costo_mostrato).
    let prezzo_cliente: number
    if (s.master_id === mineId) {
      prezzo_cliente = pagatoCliente.has(s.id) ? pagatoCliente.get(s.id)! : Number(s.costo_totale || 0)
    } else {
      const flId = primaLineaId.get(s.master_id)
      prezzo_cliente = (flId && costoTarget.has(s.id + '|' + flId)) ? costoTarget.get(s.id + '|' + flId)! : costo_mostrato
    }
    // PREZZO CORRIERE = MIO costo reale (movimento) o, se manca, il MIO listino corriere. Se sono
    // SOPRA il proprietario del contratto (nessun mio costo né mio listino per quel corriere) è un
    // semplice passaggio: prezzo corriere = prezzo cliente -> margine 0 (non guadagno su un contratto
    // che non è mio, e NON mostro il margine totale della rete sotto).
    let prezzo_corriere: number | null = costoMine.has(s.id) ? costoMine.get(s.id)! : null
    if (prezzo_corriere == null && calcMioCorr) {
      const nome = (s.corrieri as any)?.nome_contratto
      const mioCorr = (s.master_id === mineId) ? s.corriere_id : (nome ? nomeToMioCorr.get(nome) : null)
      if (mioCorr) { const r = calcMioCorr({ ...s, corriere_id: mioCorr }); if (r && r.totale != null) prezzo_corriere = r.totale }
    }
    if (prezzo_corriere == null) prezzo_corriere = prezzo_cliente
    const margine = Math.round((prezzo_cliente - prezzo_corriere) * 100) / 100
    const id_ordine = idOrdine.get(s.id) || (s as any).id_ordine_esterno || (s as any).rif_ordine || null
    const distinta_reso = distintaReso.get(s.id) || null
    return { ...s, master_rete, master_rete_id, costo_mostrato, prezzo_cliente, prezzo_corriere, margine, id_ordine, distinta_reso }
  })
  if (paged) return NextResponse.json({ rows, total: totalePaginato, page: pageParam, perPage })
  return NextResponse.json(rows)
}
