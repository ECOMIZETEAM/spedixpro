import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const body = await req.json()
  const { nomeFile, righe } = body
  let spedizioniProcessate = 0, codFile = 0, codSistema = 0, codDaPagare = 0, errori = 0
  // raggruppo le righe con contrassegno per cliente
  const perCliente: Record<string, any[]> = {}
  for (const rigaRaw of righe) {
    const riga: any = {}
    for (const kk in rigaRaw) { riga[String(kk).trim().toLowerCase()] = (rigaRaw as any)[kk] }
    const ldv = riga['ldv'] || riga['lettera di vettura'] || riga['n. spedizione'] || riga['numero']
    const importoCod = parseFloat(riga['importo'] || riga['importocod'] || riga['importo cod'] || riga['contrassegno'] || 0)
    if (!ldv) { errori++; continue }
    codFile += importoCod
    const { data: spedizione } = await supabase.from('spedizioni')
      .select('id,cliente_id,numero,contrassegno,stato_contrassegno')
      .eq('master_id', masterId)
      .ilike('numero', `%${ldv}%`)
      .limit(1).single()
    if (!spedizione || !spedizione.cliente_id) { errori++; continue }
    // anti-duplicato: se questa spedizione e gia in una distinta, salta
    const { data: giaInDistinta } = await supabase.from('distinte_contrassegni_righe').select('id').eq('spedizione_id', spedizione.id).limit(1)
    if (giaInDistinta && giaInDistinta.length > 0) { continue }
    spedizioniProcessate++
    codSistema += Number(spedizione.contrassegno || 0)
    if (spedizione.stato_contrassegno !== 'pagato') codDaPagare += importoCod
    const cid = spedizione.cliente_id
    if (!perCliente[cid]) perCliente[cid] = []
    perCliente[cid].push({ spedizione_id: spedizione.id, numero_spedizione: spedizione.numero, importo_cod: importoCod, importo_sistema: Number(spedizione.contrassegno || 0) })
  }
  // numero progressivo distinta
  const { data: ultima } = await supabase.from('distinte_contrassegni')
    .select('numero').eq('master_id', masterId).order('numero', { ascending: false }).limit(1).single()
  let numeroDistinta = (ultima?.numero || 1000)
  let codInDistinte = 0
  // creo una distinta per ogni cliente
  for (const cid in perCliente) {
    const righeCliente = perCliente[cid]
    const totale = righeCliente.reduce((s, r) => s + Number(r.importo_cod || 0), 0)
    if (totale <= 0) continue
    numeroDistinta++
    const { data: distinta } = await supabase.from('distinte_contrassegni').insert({
      master_id: masterId,
      numero: numeroDistinta,
      cliente_id: cid,
      totale_iniziale: totale,
      totale_rimborsato: totale,
      stato: 'in_lavorazione',
    }).select().single()
    if (distinta?.id) {
      codInDistinte += totale
      const righeInsert = righeCliente.map(r => ({ ...r, distinta_id: distinta.id }))
      await supabase.from('distinte_contrassegni_righe').insert(righeInsert)
    }
  }
  await supabase.from('cod_files').insert({
    master_id: masterId, nome_file: nomeFile, righe_file: righe.length,
    spedizioni_processate: spedizioniProcessate, cod_file: codFile, cod_sistema: codSistema,
    cod_da_pagare: codDaPagare, cod_in_distinte: codInDistinte, errori,
  })
  return NextResponse.json({ success: true, spedizioniProcessate, codFile, codSistema, codDaPagare, codInDistinte, errori })
}