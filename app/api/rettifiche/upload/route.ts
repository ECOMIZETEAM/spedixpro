import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { nomeFile, righe } = body

  let nProcessate = 0, nTrovate = 0, nScartati = 0, nDaRettificare = 0

  const { data: fileRec } = await supabase.from('rettifiche_files').insert({
    master_id: utente?.master_id,
    nome_file: nomeFile,
    n_tot_spedizioni: righe.length,
  }).select().single()

  const rettificheToInsert: any[] = []

  for (const riga of righe) {
    nProcessate++
    const ldv = String(riga['LDV'] || riga['N. Spedizione'] || riga['Numero'] || riga['ldv'] || '').trim()
    const pesoReale = parseFloat(String(riga['Peso reale'] || riga['peso_reale'] || riga['PesoReale'] || 0))
    const pesoVolumeReale = parseFloat(String(riga['Peso volume reale'] || riga['peso_volume_reale'] || 0))
    const costoFinale = parseFloat(String(riga['Costo finale'] || riga['costo_finale'] || 0))

    if (!ldv) { nScartati++; continue }

    const { data: spedizione } = await supabase.from('spedizioni')
      .select('id,cliente_id,peso_reale,peso_volume,costo_totale,costo_spedizione,numero')
      .eq('master_id', utente?.master_id)
      .or(`numero.ilike.%${ldv}%,tracking_number.ilike.%${ldv}%`)
      .limit(1)
      .single()

    if (!spedizione) { nScartati++; continue }
    nTrovate++

    const pesoiniziale = Number(spedizione.peso_reale || 0)
    const pesoVolumeIniziale = Number(spedizione.peso_volume || 0)
    const costoIniziale = Number(spedizione.costo_totale || 0)
    const differenza = costoFinale > 0 ? costoIniziale - costoFinale : 0

    if (Math.abs(differenza) > 0.01) nDaRettificare++

    rettificheToInsert.push({
      master_id: utente?.master_id,
      file_id: fileRec?.id,
      spedizione_id: spedizione.id,
      numero_spedizione: spedizione.numero,
      cliente_id: spedizione.cliente_id,
      peso_iniziale: pesoiniziale,
      peso_volume_iniziale: pesoVolumeIniziale,
      peso_reale: pesoReale || pesoiniziale,
      peso_volume_reale: pesoVolumeReale || pesoVolumeIniziale,
      costo_iniziale: costoIniziale,
      costo_finale: costoFinale || costoIniziale,
      differenza: differenza,
      stato: Math.abs(differenza) > 0.01 ? 'da_rettificare' : 'ok',
    })
  }

  if (rettificheToInsert.length > 0) {
    await supabase.from('rettifiche').insert(rettificheToInsert)
  }

  await supabase.from('rettifiche_files').update({
    n_processate: nProcessate,
    n_trovate: nTrovate,
    n_scartati: nScartati,
    n_da_rettificare: nDaRettificare,
  }).eq('id', fileRec?.id)

  return NextResponse.json({
    success: true,
    fileId: fileRec?.id,
    nProcessate, nTrovate, nScartati, nDaRettificare
  })
}