import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
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
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  if (!masterId) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const { nomeFile, righe } = body
  // RLS: match LDV su tutta la catena (solo discesa) -> admin; autorizzazione = check catena
  const adminDb = createAdminSupabase()

  let spedizioniProcessate = 0, codFile = 0, codSistema = 0, codDaPagare = 0, errori = 0
  const perCliente: Record<string, any[]> = {}
  const perMaster: Record<string, any[]> = {}

  for (const rigaRaw of (righe || [])) {
    const riga: any = {}
    for (const kk in rigaRaw) { riga[String(kk).trim().toLowerCase()] = (rigaRaw as any)[kk] }
    const ldv = riga['ldv'] || riga['lettera di vettura'] || riga['n. spedizione'] || riga['numero']
    const importoCod = parseFloat(riga['importo'] || riga['importocod'] || riga['importo cod'] || riga['contrassegno'] || 0)
    if (!ldv) { errori++; continue }
    codFile += importoCod

    const { data: spedizione } = await adminDb.from('spedizioni')
      .select('id,cliente_id,master_id,numero,contrassegno,stato_contrassegno')
      .ilike('numero', `%${ldv}%`)
      .limit(1).single()
    if (!spedizione) { errori++; continue }

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

    const rigaDistinta = {
      spedizione_id: spedizione.id, numero_spedizione: spedizione.numero,
      importo_cod: importoCod, importo_sistema: Number(spedizione.contrassegno || 0),
    }
    if (idx === 0) {
      // Cliente diretto: distinta di rimessa verso il cliente (flusso attuale)
      if (!spedizione.cliente_id) { errori++; continue }
      if (!perCliente[spedizione.cliente_id]) perCliente[spedizione.cliente_id] = []
      perCliente[spedizione.cliente_id].push(rigaDistinta)
    } else {
      // Catena: la rimessa si ferma al primo master sotto chi carica
      const target = catena[idx - 1]
      if (!perMaster[target]) perMaster[target] = []
      perMaster[target].push(rigaDistinta)
    }
  }

  const { data: ultima } = await adminDb.from('distinte_contrassegni')
    .select('numero').eq('master_id', masterId).order('numero', { ascending: false }).limit(1).maybeSingle()
  let numeroDistinta = (ultima?.numero || 1000)
  let codInDistinte = 0

  async function creaDistinta(campi: any, righeDist: any[]) {
    const totale = righeDist.reduce((s, r) => s + Number(r.importo_cod || 0), 0)
    if (totale <= 0) return
    numeroDistinta++
    const { data: distinta } = await supabase.from('distinte_contrassegni').insert({
      master_id: masterId, numero: numeroDistinta,
      totale_iniziale: totale, totale_rimborsato: totale,
      stato: 'in_lavorazione', ...campi,
    }).select().single()
    if (distinta?.id) {
      codInDistinte += totale
      await supabase.from('distinte_contrassegni_righe').insert(righeDist.map(r => ({ ...r, distinta_id: distinta.id })))
    }
  }

  for (const cid in perCliente) await creaDistinta({ cliente_id: cid, target_master_id: null }, perCliente[cid])
  for (const mid in perMaster) await creaDistinta({ cliente_id: null, target_master_id: mid }, perMaster[mid])

  await supabase.from('cod_files').insert({
    master_id: masterId, nome_file: nomeFile, righe_file: (righe || []).length,
    spedizioni_processate: spedizioniProcessate, cod_file: codFile, cod_sistema: codSistema,
    cod_da_pagare: codDaPagare, cod_in_distinte: codInDistinte, errori,
  })
  return NextResponse.json({ success: true, spedizioniProcessate, codFile, codSistema, codDaPagare, codInDistinte, errori })
}
