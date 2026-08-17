import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// Risale la catena dei master: [masterId, padre, nonno, ...]
async function risaliCatena(adminDb: any, masterId: string): Promise<string[]> {
  const path: string[] = []
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    path.push(cur)
    const { data: m } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = m?.parent_master_id || null
  }
  return path
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  const masterId = utente?.master_id
  if (!masterId) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const { nomeFile, righe } = body
  // RLS: match LDV su tutta la catena (solo discesa) -> admin; autorizzazione = check catena
  const adminDb = createAdminSupabase()
  // Chunking: il client spezza i file grossi in blocchi per mostrare l'avanzamento ed evitare il
  // timeout della funzione. I blocchi passano scriviLog=false; il record riepilogo del file si scrive
  // con una chiamata finale `soloLog` che porta i totali già aggregati dal client.
  const scriviLog = body.scriviLog !== false
  if (body.soloLog) {
    const s = body.soloLog || {}
    await supabase.from('cod_files').insert({
      master_id: masterId, nome_file: nomeFile, righe_file: Number(s.righeFile) || 0,
      spedizioni_processate: Number(s.spedizioniProcessate) || 0, cod_file: Number(s.codFile) || 0,
      cod_sistema: Number(s.codSistema) || 0, cod_da_pagare: Number(s.codDaPagare) || 0,
      cod_in_distinte: 0, errori: Number(s.errori) || 0,
    })
    return NextResponse.json({ success: true, logged: true })
  }
  // La catena di un master è la stessa per tutte le sue righe: si risale UNA volta e si riusa.
  const catenaCache = new Map<string, string[]>()
  const getCatena = async (mid: string): Promise<string[]> => {
    const c = catenaCache.get(mid); if (c) return c
    const path = await risaliCatena(adminDb, mid); catenaCache.set(mid, path); return path
  }

  let spedizioniProcessate = 0, codFile = 0, codSistema = 0, codDaPagare = 0, errori = 0, saltateNonPagate = 0
  let doppioniFile = 0, giaPagati = 0, giaInDistintaCount = 0, giaInSostaCount = 0
  const inSosta: any[] = []   // righe da mettere nell'area "da caricare" (niente distinte automatiche)
  // Anti-doppione DENTRO il file: la stessa spedizione ripetuta su più righe entrerebbe due volte
  // in distinta (il check su DB vede solo le distinte GIÀ salvate) → si pagherebbe doppio.
  const vistiInFile = new Set<string>()
  // GIA' IN SOSTA da un file/chunk PRECEDENTE: la stessa LDV non si ricarica. Prima solo il vincolo
  // unico del DB la fermava DOPO (upsert ignoreDuplicates), ma la riga veniva comunque CONTATA come
  // "processata": ricaricando lo stesso file i numeri si gonfiavano e sembrava di caricare due volte
  // la stessa LDV. Ora la si riconosce PRIMA (set caricato a inizio richiesta, quindi copre anche i
  // chunk gia' scritti) e la si conta a parte, senza gonfiare "processate"/"da pagare".
  const giaInSostaSet = new Set<string>()
  for (const r of await fetchAll(() => adminDb.from('cod_da_caricare').select('spedizione_id').eq('master_id', masterId))) {
    if ((r as any).spedizione_id) giaInSostaSet.add((r as any).spedizione_id)
  }

  for (const rigaRaw of (righe || [])) {
    const riga: any = {}
    for (const kk in rigaRaw) { riga[String(kk).trim().toLowerCase()] = (rigaRaw as any)[kk] }
    // 'shipment' = export contrassegni SpediamoPro (codice spedizione del provider, es. 6A54B0F9AB03D)
    const ldv = String(riga['ldv'] || riga['lettera di vettura'] || riga['n. spedizione'] || riga['numero'] || riga['shipment'] || '').trim()
    // Importo VERSATO dal corriere. Nei file Ecomize/Em express c'e' 'pagato' (quanto il corriere ha
    // davvero versato) accanto a 'contrassegno' (il nominale): a scendere al cliente e' il PAGATO.
    // Restano gli alias storici + 'COD amount [EUR]' (SpediamoPro). Virgola decimale gestita.
    let importoRaw = riga['pagato'] ?? riga['importo'] ?? riga['importocod'] ?? riga['importo cod'] ?? riga['contrassegno']
    if (importoRaw == null) { const k = Object.keys(riga).find(x => x.startsWith('cod amount')); if (k) importoRaw = riga[k] }
    const importoCod = parseFloat(String(importoRaw ?? 0).replace(',', '.')) || 0
    if (!ldv) { errori++; continue }
    // Colonna Status (SpediamoPro): in distinta vanno SOLO i contrassegni gia' PAGATI dal corriere.
    const statusRiga = String(riga['status'] ?? '').trim().toLowerCase()
    if (statusRiga && !['paid', 'pagato', 'pagata'].includes(statusRiga)) { saltateNonPagate++; continue }
    // Formato Ecomize/Em express: se c'e' la colonna 'pagato' ed e' 0 (o vuota) il corriere non ha
    // ancora versato quel contrassegno → si salta, esattamente come lo status non-pagato di sopra.
    if (('pagato' in riga) && !(importoCod > 0)) { saltateNonPagate++; continue }
    codFile += importoCod

    // Match ESATTO per primo (usa l'indice su numero → veloce): copre la stragrande maggioranza.
    let { data: spedizione } = await adminDb.from('spedizioni')
      .select('id,cliente_id,master_id,numero,contrassegno,stato_contrassegno')
      .eq('numero', ldv)
      .limit(1).maybeSingle()
    if (!spedizione) {
      // Ripiego: match parziale (numero che CONTIENE la LDV). È una scansione, ma gira SOLO sulle
      // righe che l'esatto non ha risolto, non più su tutte.
      const rLike = await adminDb.from('spedizioni')
        .select('id,cliente_id,master_id,numero,contrassegno,stato_contrassegno')
        .ilike('numero', `%${ldv}%`)
        .limit(1).maybeSingle()
      spedizione = rLike.data as any
    }
    if (!spedizione && /^[A-Za-z0-9_-]+$/.test(ldv)) {
      // Export SpediamoPro: 'Shipment' e' il codice del provider (raw_response.code), non la LDV in elenco.
      const r2 = await adminDb.from('spedizioni')
        .select('id,cliente_id,master_id,numero,contrassegno,stato_contrassegno')
        .or(`tracking_number.eq.${ldv},raw_response->>code.eq.${ldv}`)
        .limit(1).maybeSingle()
      spedizione = r2.data as any
    }
    if (!spedizione) { errori++; continue }

    // Doppione nello STESSO file → la seconda riga si salta (un contrassegno si paga UNA volta).
    if (vistiInFile.has(spedizione.id)) { doppioniFile++; continue }
    vistiInFile.add(spedizione.id)
    // Contrassegno GIÀ PAGATO in una distinta precedente → mai ripagarlo.
    if (spedizione.stato_contrassegno === 'pagato') { giaPagati++; continue }
    // GIÀ IN SOSTA (caricato da un file/chunk precedente, non ancora messo in distinta): non si
    // ricarica e NON si riconta come "processata". Risparmia anche la query giaInDistinta qui sotto.
    if (giaInSostaSet.has(spedizione.id)) { giaInSostaCount++; continue }

    // Solo discesa: chi carica deve essere il master della spedizione o un antenato
    const catena = await getCatena(spedizione.master_id)
    const idx = catena.indexOf(masterId)
    if (idx === -1) { errori++; continue }

    // Anti-duplicato PER LIVELLO: la stessa LDV puo' stare in una distinta di M1 (verso M2)
    // e in una di M2 (verso il cliente) -> controllo solo le distinte del MIO master
    const { data: giaInDistinta } = await adminDb
      .from('distinte_contrassegni_righe')
      .select('id, distinte_contrassegni!inner(master_id)')
      .eq('spedizione_id', spedizione.id)
      .eq('distinte_contrassegni.master_id', masterId)
      .limit(1)
    if (giaInDistinta && giaInDistinta.length > 0) { giaInDistintaCount++; continue }   // gia' in una MIA distinta

    // AREA DI SOSTA: il contrassegno NON scende subito al livello sotto. Si registra qui col suo
    // destinatario (cliente diretto oppure primo master sotto di me) e sara' il master, dopo le
    // sue verifiche, a decidere A CHI caricarlo da Distinte Contrassegni.
    if (idx === 0) {
      if (!spedizione.cliente_id) { errori++; continue }
      inSosta.push({ master_id: masterId, spedizione_id: spedizione.id, importo: importoCod,
        cliente_id: spedizione.cliente_id, target_master_id: null, origine: 'file' })
    } else {
      inSosta.push({ master_id: masterId, spedizione_id: spedizione.id, importo: importoCod,
        cliente_id: null, target_master_id: catena[idx - 1], origine: 'file' })
    }
    // Conta SOLO le righe davvero messe in sosta (DOPO tutti i filtri): cosi' ogni riga del file
    // finisce in UNA categoria sola e il totale torna sempre (niente riga contata due volte).
    spedizioniProcessate++
    codSistema += Number(spedizione.contrassegno || 0)
    if (spedizione.stato_contrassegno !== 'pagato') codDaPagare += importoCod
  }

  // Inserimento nell'area di sosta. Il vincolo unico (master, spedizione) rende l'operazione
  // ripetibile: ricaricando lo stesso file non si duplica nulla.
  let inAttesa = 0
  if (inSosta.length) {
    for (let i = 0; i < inSosta.length; i += 500) {
      const { data: ins } = await adminDb.from('cod_da_caricare')
        .upsert(inSosta.slice(i, i + 500), { onConflict: 'master_id,spedizione_id', ignoreDuplicates: true })
        .select('id')
      inAttesa += (ins || []).length
    }
  }
  const codInDistinte = 0   // nessuna distinta creata dall'upload: si creano al "Carica"

  // RICONCILIAZIONE: ogni riga del file DEVE finire in UNA categoria. Se il totale non torna
  // (nonClassificate > 0) c'e' una riga persa per strada, e va segnalata invece di sparire.
  const righeTot = (righe || []).length
  const nonClassificate = righeTot - (spedizioniProcessate + errori + saltateNonPagate + doppioniFile + giaPagati + giaInDistintaCount + giaInSostaCount)

  // In modalità chunk il record riepilogo NON si scrive per ogni blocco: lo scrive la chiamata finale
  // `soloLog` con i totali del file. Le chiamate singole (scriviLog=true) restano identiche a prima.
  if (scriviLog) {
    await supabase.from('cod_files').insert({
      master_id: masterId, nome_file: nomeFile, righe_file: righeTot,
      spedizioni_processate: spedizioniProcessate, cod_file: codFile, cod_sistema: codSistema,
      cod_da_pagare: codDaPagare, cod_in_distinte: codInDistinte, errori,
    })
  }
  return NextResponse.json({
    success: true, spedizioniProcessate, codFile, codSistema, codDaPagare, codInDistinte,
    errori, saltateNonPagate, doppioniFile, giaPagati,
    giaInDistinta: giaInDistintaCount,          // gia' in una mia distinta (prima: saltate in silenzio)
    giaInSosta: giaInSostaCount,                // gia' in area di sosta (re-upload dello stesso file)
    nonClassificate,                            // DEVE essere 0: se >0 qualche riga non e' stata classificata
    inAttesa,                                   // quante spedizioni sono ora in attesa di essere caricate
    righeFile: righeTot,
  })
}
