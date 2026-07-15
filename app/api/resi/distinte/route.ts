import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { calcolaPrezzoListino } from '@/lib/pricing'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const clienteIdRaw = req.nextUrl.searchParams.get('cliente_id')
  // "m:<masterId>" = sotto-master agganciato: le sue distinte hanno target_master_id
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (masterSel) query = query.eq('target_master_id', masterSel)
  else if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
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
  const { spedizioniIds, clienteId, targetMasterId, totale, voci } = body
  const adminDb = createAdminSupabase()

  // ── RAMO CATENA: reso verso un master figlio (addebito del prezzo che LUI ha pagato) ──
  if (targetMasterId && !clienteId) {
    const { count: cM } = await supabase.from('distinte_resi').select('*', {count:'exact',head:true}).eq('master_id', utente?.master_id)
    const numeroM = (cM||0) + 1
    const { data: distintaM, error: errM } = await supabase.from('distinte_resi').insert({
      master_id: utente?.master_id, cliente_id: null, target_master_id: targetMasterId,
      numero: numeroM, totale_ldv: (voci||[]).length, totale: totale || 0, voci, stato: 'chiusa',
    }).select().single()
    if (errM) return NextResponse.json({ error: errM.message }, { status: 400 })
    for (const v of (voci || [])) {
      await adminDb.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', v.id)
      // prezzo pagato dal master figlio su quella LDV = movimento spedizione con master_target_id
      const { data: movR } = await adminDb.from('movimenti')
        .select('importo').eq('spedizione_id', v.id).eq('master_target_id', targetMasterId)
        .in('tipo', ['spedizione', 'rettifica'])
      const costoReso = Math.abs((movR || []).reduce((a: number, m: any) => a + Number(m.importo || 0), 0))
      if (costoReso <= 0) continue
      try {
        await registraMovimentoMaster(adminDb, {
          masterOwnerId: utente?.master_id, masterTargetId: targetMasterId,
          tipo: 'reso', descrizione: `Reso ${v.numero}`, importo: -costoReso,
          spedizioneId: v.id, createdBy: user.id,
        })
      } catch (e) { console.error('Errore addebito reso master:', e) }
    }
    return NextResponse.json({ id: distintaM.id, numero: numeroM })
  }
  const { count } = await supabase.from('distinte_resi').select('*', {count:'exact',head:true}).eq('master_id', utente?.master_id)
  const numero = (count||0) + 1
  const { data: cliRec } = await supabase.from('clienti').select('listino_cliente_id').eq('id', clienteId).single()
  let totaleReso = 0
  const resoRows: { v: any; costoReso: number }[] = []
  for (const v of (voci || [])) {
    await supabase.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', v.id)
    const { data: sp } = await supabase.from('spedizioni')
      .select('costo_totale,dest_provincia,dest_cap,dest_paese,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,corriere_id')
      .eq('id', v.id).single()

    // ── Reso = solo NOLO: prezzo fascia del listino cliente (senza contrassegno/assicurazione) ──
    let costoReso = 0
    if (cliRec?.listino_cliente_id) {
      const packages = (Array.isArray(sp?.colli_dettaglio) && sp!.colli_dettaglio.length)
        ? sp!.colli_dettaglio.map((c: any) => ({ weight: sp!.peso_reale || 1, length: c.lunghezza, width: c.larghezza, height: c.altezza }))
        : [{ weight: sp?.peso_reale || 1, length: sp?.lunghezza, width: sp?.larghezza, height: sp?.altezza }]
      const ris = await calcolaPrezzoListino(adminDb, {
        listinoId: cliRec.listino_cliente_id,
        provincia: sp?.dest_provincia || '', cap: sp?.dest_cap || '', paese: sp?.dest_paese || 'IT',
        packages, corriereId: sp?.corriere_id,
      })
      costoReso = ris?.prezzo || 0
    }
    // fallback (cliente senza listino / non calcolabile): usa il costo totale, mai negativo
    if (!(costoReso > 0)) costoReso = Math.max(0, Number(sp?.costo_totale || 0))

    totaleReso += costoReso
    resoRows.push({ v, costoReso })
  }

  const { data: distinta, error } = await supabase.from('distinte_resi').insert({
    master_id: utente?.master_id,
    cliente_id: clienteId,
    numero,
    totale_ldv: spedizioniIds.length,
    totale: totaleReso, // solo nolo (coerente con l'addebito)
    voci,
    stato: 'chiusa',
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Addebito atomico del nolo al credito del cliente (RPC: update credito + movimento in transazione)
  for (const { v, costoReso } of resoRows) {
    if (!(costoReso > 0)) continue
    try {
      await registraMovimento(supabase, {
        masterId: utente?.master_id, clienteId, tipo: 'reso',
        descrizione: `Reso ${v.numero}`, importo: -costoReso,
        spedizioneId: v.id, createdBy: user.id,
      })
    } catch (e) { console.error('Errore addebito reso cliente:', e) }
  }
  return NextResponse.json({ id: distinta.id, numero })
}