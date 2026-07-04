import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimentoMaster } from '@/lib/movimenti'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const clienteId = req.nextUrl.searchParams.get('cliente_id')
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  const { data } = await query
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
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
      const { data: mov } = await adminDb.from('movimenti')
        .select('importo').eq('spedizione_id', v.id).eq('master_target_id', targetMasterId)
        .eq('tipo', 'spedizione').limit(1).maybeSingle()
      const costoReso = Math.abs(Number(mov?.importo || 0))
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
  const { data: distinta, error } = await supabase.from('distinte_resi').insert({
    master_id: utente?.master_id,
    cliente_id: clienteId,
    numero,
    totale_ldv: spedizioniIds.length,
    totale,
    voci,
    stato: 'chiusa',
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  let totaleReso = 0
  const { data: cliRec } = await supabase.from('clienti').select('credito').eq('id', clienteId).single()
  let saldoCorrente = Number(cliRec?.credito || 0)
  for (const v of (voci || [])) {
    await supabase.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', v.id)
    const { data: sp } = await supabase.from('spedizioni').select('costo_totale,contrassegno,assicurazione').eq('id', v.id).single()
    const costoReso = Number(sp?.costo_totale || 0) - Number(sp?.contrassegno || 0) - Number(sp?.assicurazione || 0)
    saldoCorrente = saldoCorrente - costoReso
    totaleReso += costoReso
    await supabase.from('movimenti').insert({
      master_id: utente?.master_id, cliente_id: clienteId,
      tipo: 'reso',
      descrizione: `Reso ${v.numero}`,
      importo: -costoReso, saldo_dopo: saldoCorrente, spedizione_id: v.id,
    })
  }
  const nuovoCredito = saldoCorrente
  await supabase.from('clienti').update({ credito: nuovoCredito }).eq('id', clienteId)
  return NextResponse.json({ id: distinta.id, numero })
}