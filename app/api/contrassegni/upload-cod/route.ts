import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { nomeFile, righe } = body

  let spedizioniProcessate = 0
  let codFile = 0
  let codSistema = 0
  let codDaPagare = 0
  let errori = 0

  for (const rigaRaw of righe) {
    const riga: any = {}
    for (const kk in rigaRaw) { riga[String(kk).trim().toLowerCase()] = (rigaRaw as any)[kk] }
    const ldv = riga['ldv'] || riga['lettera di vettura'] || riga['n. spedizione'] || riga['numero']
    const importoCod = parseFloat(riga['importo'] || riga['importocod'] || riga['importo cod'] || riga['contrassegno'] || 0)
    if (!ldv) { errori++; continue }
    codFile += importoCod

    const { data: spedizione } = await supabase.from('spedizioni')
      .select('id,contrassegno,stato_contrassegno')
      .eq('master_id', utente?.master_id)
      .ilike('numero', `%${ldv}%`)
      .single()

    if (!spedizione) { errori++; continue }
    spedizioniProcessate++
    codSistema += Number(spedizione.contrassegno || 0)
    if (spedizione.stato_contrassegno !== 'pagato') {
      codDaPagare += importoCod
    }
  }

  await supabase.from('cod_files').insert({
    master_id: utente?.master_id,
    nome_file: nomeFile,
    righe_file: righe.length,
    spedizioni_processate: spedizioniProcessate,
    cod_file: codFile,
    cod_sistema: codSistema,
    cod_da_pagare: codDaPagare,
    cod_in_distinte: 0,
    errori,
  })

  return NextResponse.json({ success: true, spedizioniProcessate, codFile, codSistema, codDaPagare, errori })
}