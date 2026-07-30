import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const fileId = req.nextUrl.searchParams.get('fileId')
  let query = supabase.from('rettifiche')
    .select('*, clienti(ragione_sociale), masters:target_master_id(nome)')
    .eq('master_id', utente?.master_id)
    .eq('confermata', false)
    .order('created_at', { ascending: false })
  // Agente: solo le rettifiche dei suoi clienti.
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (fileId) query = query.eq('file_id', fileId)
  const { data } = await query
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
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
  // Client amministrativo dichiarato QUI, prima di entrambi i cicli: serve sia alle rettifiche di
  // catena sia a quelle verso i clienti (piu' in basso). Era dichiarato dentro il blocco
  // "if (diCatena.length)" e usato anche fuori: il progetto ignora gli errori di tipo in
  // compilazione, quindi passava, ma a runtime la variabile non esisteva e OGNI rettifica verso un
  // cliente finiva nel catch, persa senza traccia.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminDb = createAdminSupabase()

  if (diCatena.length) {
    const { registraMovimentoMaster } = await import('@/lib/movimenti')
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

    // Crea movimento per ogni rettifica (addebito ATOMICO al credito via RPC).
    // Nessun registro parallelo: la rettifica sta in 'movimenti' (con saldo_dopo), l'unica
    // fonte letta dalle liste. La vecchia copia in 'movimenti_clienti' non veniva mai letta
    // né controllata per errori e quella tabella è rimasta vuota, facendo apparire vuote le
    // liste pur essendo gli addebiti regolarmente fatti.
    for (const r of retts) {
      const diff = Math.abs(Number(r.differenza || 0))
      if (diff <= 0) continue
      const descr = `Rettifica ${r.numero_spedizione} ( Peso inserito: ${r.peso_iniziale} Kg - peso scansione: ${r.peso_reale} Kg )`
      try {
        // scala credito + scrive in 'movimenti' (Lista Movimenti) in un'unica transazione.
        // Client AMMINISTRATIVO: ad `authenticated` viene tolto il privilegio di scrivere
        // clienti.credito (permetteva a ogni cliente di ricaricarsi da solo). Qui l'ambito e' gia'
        // garantito: le rettifiche sono state lette filtrando su master_id di chi chiama.
        await registraMovimento(adminDb, {
          masterId: utente?.master_id, clienteId, tipo: 'rettifica',
          descrizione: descr, importo: -diff, spedizioneId: r.spedizione_id || null, createdBy: user.id,
        })
      } catch (e) { console.error('Errore addebito rettifica cliente:', e); continue }
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
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
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
