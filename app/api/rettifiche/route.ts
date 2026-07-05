import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const fileId = req.nextUrl.searchParams.get('fileId')
  let query = supabase.from('rettifiche')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .eq('confermata', false)
    .order('created_at', { ascending: false })
  if (fileId) query = query.eq('file_id', fileId)
  const { data } = await query
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { rettificaIds } = body
  if (!rettificaIds?.length) return NextResponse.json({ error: 'Nessuna rettifica selezionata' }, { status: 400 })

  const { data: rettifiche } = await supabase.from('rettifiche')
    .select('*')
    .in('id', rettificaIds)
    .eq('master_id', utente?.master_id)
    .eq('confermata', false)

  if (!rettifiche?.length) return NextResponse.json({ error: 'Nessuna rettifica trovata' }, { status: 404 })

  // Rettifiche verso master della catena: addebito/accredito diretto al master target.
  // Segno CORRETTO: differenza = costo_iniziale - costo_finale -> negativa = addebito, positiva = accredito.
  const diCatena = rettifiche.filter(r => r.target_master_id)
  const diClienti = rettifiche.filter(r => !r.target_master_id && r.cliente_id)
  if (diCatena.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { registraMovimentoMaster } = await import('@/lib/movimenti')
    const adminDb = createAdminSupabase()
    for (const r of diCatena) {
      const diff = Number(r.differenza || 0)
      if (Math.abs(diff) <= 0.005) continue
      try {
        await registraMovimentoMaster(adminDb, {
          masterOwnerId: utente?.master_id, masterTargetId: r.target_master_id,
          tipo: 'rettifica',
          descrizione: `Rettifica ${r.numero_spedizione} ( Peso inserito: ${r.peso_iniziale} Kg - peso scansione: ${r.peso_reale} Kg )`,
          importo: diff,
          spedizioneId: r.spedizione_id || null, createdBy: user.id,
        })
      } catch (e) { console.error('Errore rettifica master:', e) }
    }
    await supabase.from('rettifiche').update({ confermata: true, stato: 'confermata' }).in('id', diCatena.map(r => r.id))
  }

  // Raggruppa per cliente
  const clientiMap: Record<string, any[]> = {}
  diClienti.forEach(r => {
    if (!clientiMap[r.cliente_id]) clientiMap[r.cliente_id] = []
    clientiMap[r.cliente_id].push(r)
  })

  for (const [clienteId, retts] of Object.entries(clientiMap)) {
    // Calcola totale da addebitare (differenza positiva = costo maggiore)
    const totaleDiff = retts.reduce((acc, r) => acc + Math.abs(Number(r.differenza || 0)), 0)
    if (totaleDiff <= 0) continue

    // Recupera credito residuo attuale
    const { data: cliRec } = await supabase.from('clienti').select('credito').eq('id', clienteId).single()
    const creditoAttuale = Number(cliRec?.credito || 0)
    const nuovoCreditoResiduo = creditoAttuale - totaleDiff
    await supabase.from('clienti').update({ credito: nuovoCreditoResiduo }).eq('id', clienteId)

    // Crea movimento per ogni rettifica
    for (const r of retts) {
      const diff = Math.abs(Number(r.differenza || 0))
      if (diff <= 0) continue
      await supabase.from('movimenti_clienti').insert({
        master_id: utente?.master_id,
        cliente_id: clienteId,
        tipo: 'rettifica',
        descrizione: `Rettifica ${r.numero_spedizione} ( Peso inserito: ${r.peso_iniziale} Kg - peso scansione: ${r.peso_reale} Kg )`,
        prezzo_unitario: diff,
        quantita: 1,
        iva: 0,
        importo: diff,
        totale_iva: 0,
        totale: diff,
        credito_residuo: nuovoCreditoResiduo,
        data_acquisto: new Date().toISOString().split('T')[0],
      })
      // scrivo anche in 'movimenti' per la Lista Movimenti
      await supabase.from('movimenti').insert({
        master_id: utente?.master_id, cliente_id: clienteId,
        tipo: 'rettifica',
        descrizione: `Rettifica ${r.numero_spedizione} ( Peso inserito: ${r.peso_iniziale} Kg - peso scansione: ${r.peso_reale} Kg )`,
        importo: -diff, saldo_dopo: nuovoCreditoResiduo,
        spedizione_id: r.spedizione_id || null,
      })
    }

    // Aggiorna costo spedizioni
    for (const r of retts) {
      if (r.spedizione_id) {
        await supabase.from('spedizioni').update({
          costo_totale: r.costo_finale,
          peso_fatturato: r.peso_reale,
        }).eq('id', r.spedizione_id)
      }
    }
  }

  // Segna rettifiche come confermate
  await supabase.from('rettifiche').update({ confermata: true, stato: 'confermata' }).in('id', rettificaIds)

  return NextResponse.json({ success: true, rettificate: rettifiche.length })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { rettificaIds } = body
  if (!rettificaIds?.length) return NextResponse.json({ error: 'Nessuna rettifica selezionata' }, { status: 400 })
  const { error } = await supabase.from('rettifiche')
    .delete()
    .in('id', rettificaIds)
    .eq('master_id', utente?.master_id)
    .eq('confermata', false)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, eliminate: rettificaIds.length })
}
