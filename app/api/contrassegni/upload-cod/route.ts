import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

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

  let spedizioniProcessate = 0, codFile = 0, codSistema = 0, codDaPagare = 0, errori = 0, saltateNonPagate = 0
  let doppioniFile = 0, giaPagati = 0
  const inSosta: any[] = []   // righe da mettere nell'area "da caricare" (niente distinte automatiche)
  // Anti-doppione DENTRO il file: la stessa spedizione ripetuta su più righe entrerebbe due volte
  // in distinta (il check su DB vede solo le distinte GIÀ salvate) → si pagherebbe doppio.
  const vistiInFile = new Set<string>()

  for (const rigaRaw of (righe || [])) {
    const riga: any = {}
    for (const kk in rigaRaw) { riga[String(kk).trim().toLowerCase()] = (rigaRaw as any)[kk] }
    // 'shipment' = export contrassegni SpediamoPro (codice spedizione del provider, es. 6A54B0F9AB03D)
    const ldv = String(riga['ldv'] || riga['lettera di vettura'] || riga['n. spedizione'] || riga['numero'] || riga['shipment'] || '').trim()
    // Importo: alias storici + 'COD amount [EUR]' (SpediamoPro) + virgola decimale
    let importoRaw = riga['importo'] ?? riga['importocod'] ?? riga['importo cod'] ?? riga['contrassegno']
    if (importoRaw == null) { const k = Object.keys(riga).find(x => x.startsWith('cod amount')); if (k) importoRaw = riga[k] }
    const importoCod = parseFloat(String(importoRaw ?? 0).replace(',', '.')) || 0
    if (!ldv) { errori++; continue }
    // Colonna Status (SpediamoPro): in distinta vanno SOLO i contrassegni gia' PAGATI dal corriere.
    const statusRiga = String(riga['status'] ?? '').trim().toLowerCase()
    if (statusRiga && !['paid', 'pagato', 'pagata'].includes(statusRiga)) { saltateNonPagate++; continue }
    codFile += importoCod

    let { data: spedizione } = await adminDb.from('spedizioni')
      .select('id,cliente_id,master_id,numero,contrassegno,stato_contrassegno')
      .ilike('numero', `%${ldv}%`)
      .limit(1).single()
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

    // Solo discesa: chi carica deve essere il master della spedizione o un antenato
    const catena = await risaliCatena(adminDb, spedizione.master_id)
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
    if (giaInDistinta && giaInDistinta.length > 0) { continue }

    spedizioniProcessate++
    codSistema += Number(spedizione.contrassegno || 0)
    if (spedizione.stato_contrassegno !== 'pagato') codDaPagare += importoCod

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

  await supabase.from('cod_files').insert({
    master_id: masterId, nome_file: nomeFile, righe_file: (righe || []).length,
    spedizioni_processate: spedizioniProcessate, cod_file: codFile, cod_sistema: codSistema,
    cod_da_pagare: codDaPagare, cod_in_distinte: codInDistinte, errori,
  })
  return NextResponse.json({
    success: true, spedizioniProcessate, codFile, codSistema, codDaPagare, codInDistinte,
    errori, saltateNonPagate, doppioniFile, giaPagati,
    inAttesa,                                   // quante spedizioni sono ora in attesa di essere caricate
    righeFile: (righe || []).length,
  })
}
