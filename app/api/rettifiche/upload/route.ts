import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaPrezzoListino } from '@/lib/pricing'
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
    const ldv = String(riga['LDV'] || riga['N. Spedizione'] || riga['Numero'] || riga['ldv'] || riga['Ldv'] || '').trim()
    const pesoReale = parseFloat(String(riga['Peso reale'] || riga['peso_reale'] || riga['PesoReale'] || riga['Peso'] || riga['peso'] || 0))
    if (!ldv) { nScartati++; continue }
    const { data: spedizione } = await supabase.from('spedizioni')
      .select('id,cliente_id,peso_reale,peso_fatturato,peso_volume,costo_totale,costo_spedizione,numero,dest_provincia,corriere_id')
      .eq('master_id', utente?.master_id)
      .or(`numero.ilike.%${ldv}%,tracking_number.ilike.%${ldv}%`)
      .limit(1).single()
    if (!spedizione) { nScartati++; continue }
    nTrovate++
    const pesoIniziale = Number(spedizione.peso_fatturato || spedizione.peso_reale || 0)
    const pesoVolumeIniziale = Number(spedizione.peso_volume || 0)
    const costoIniziale = Number(spedizione.costo_totale || 0)
    // RICALCOLO automatico del costo col peso reale dal file
    let costoFinale = costoIniziale
    try {
      const { data: cli } = await supabase.from('clienti').select('listino_cliente_id').eq('id', spedizione.cliente_id).single()
      if (cli?.listino_cliente_id && pesoReale > 0) {
        const ric = await calcolaPrezzoListino(supabase, {
          listinoId: cli.listino_cliente_id,
          provincia: spedizione.dest_provincia || '',
          packages: [{ weight: pesoReale }],
          corriereId: spedizione.corriere_id || null,
        })
        if (ric && ric.prezzo > 0) costoFinale = ric.prezzo
      }
    } catch {}
    const differenza = costoIniziale - costoFinale
    if (Math.abs(differenza) > 0.01) nDaRettificare++
    rettificheToInsert.push({
      master_id: utente?.master_id,
      file_id: fileRec?.id,
      spedizione_id: spedizione.id,
      numero_spedizione: spedizione.numero,
      cliente_id: spedizione.cliente_id,
      peso_iniziale: pesoIniziale,
      peso_volume_iniziale: pesoVolumeIniziale,
      peso_reale: pesoReale || pesoIniziale,
      peso_volume_reale: 0,
      costo_iniziale: costoIniziale,
      costo_finale: costoFinale,
      differenza: differenza,
      stato: Math.abs(differenza) > 0.01 ? 'da_rettificare' : 'ok',
    })
  }
  if (rettificheToInsert.length > 0) {
    await supabase.from('rettifiche').insert(rettificheToInsert)
  }
  await supabase.from('rettifiche_files').update({
    n_processate: nProcessate, n_trovate: nTrovate, n_scartati: nScartati, n_da_rettificare: nDaRettificare,
  }).eq('id', fileRec?.id)
  return NextResponse.json({ success: true, fileId: fileRec?.id, nProcessate, nTrovate, nScartati, nDaRettificare })
}