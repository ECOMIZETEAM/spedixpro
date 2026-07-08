import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { clienteId, descrizione, prezzoUnitario, quantita, iva, vettore, dataAcquisto } = body
  if (!clienteId) return NextResponse.json({ error: 'Cliente obbligatorio' }, { status: 400 })
  if (!descrizione) return NextResponse.json({ error: 'Descrizione obbligatoria' }, { status: 400 })
  const importo = parseFloat(prezzoUnitario) * parseInt(quantita)
  const totaleIva = importo * (parseFloat(iva) / 100)
  const totale = importo + totaleIva

  // Spesa addebitata a un SOTTO-MASTER (clienteId = "m:<id>")
  if (typeof clienteId === 'string' && clienteId.startsWith('m:')) {
    const targetMasterId = clienteId.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sub } = await admin.from('masters').select('id,parent_master_id').eq('id', targetMasterId).single()
    if (!sub || sub.parent_master_id !== utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    try {
      const { registraMovimentoMaster } = await import('@/lib/movimenti')
      await registraMovimentoMaster(admin, { masterOwnerId: utente!.master_id!, masterTargetId: targetMasterId, tipo: 'rettifica', descrizione, importo: -totale, riferimento: vettore || null })
    } catch (e: any) { return NextResponse.json({ error: e.message || 'Errore movimento' }, { status: 400 }) }
    return NextResponse.json({ success: true })
  }

  try {
    await registraMovimento(supabase, {
      masterId: utente?.master_id,
      clienteId,
      tipo: 'rettifica',
      descrizione,
      importo: -totale,
      riferimento: vettore || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Errore movimento' }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const clienteIdRaw = req.nextUrl.searchParams.get('clienteId')
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')

  // Storia di un SOTTO-MASTER (clienteId = "m:<id>"): dai movimenti tra master
  if (clienteIdRaw && clienteIdRaw.startsWith('m:')) {
    const targetMasterId = clienteIdRaw.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sub } = await admin.from('masters').select('id,parent_master_id,nome').eq('id', targetMasterId).single()
    if (!sub || sub.parent_master_id !== utente?.master_id) return NextResponse.json([])
    let q = admin.from('movimenti').select('id,tipo,descrizione,importo,saldo_dopo,created_at').eq('master_target_id', targetMasterId).order('created_at', { ascending: false })
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    const { data } = await q
    return NextResponse.json((data || []).map((m: any) => ({
      id: m.id, tipo: m.tipo, descrizione: m.descrizione,
      prezzo_unitario: Math.abs(Number(m.importo) || 0), quantita: 1, iva: 0,
      totale: Math.abs(Number(m.importo) || 0), credito_residuo: m.saldo_dopo,
      data_acquisto: (m.created_at || '').split('T')[0], created_at: m.created_at,
      clienti: { ragione_sociale: sub.nome },
    })))
  }
  const clienteId = clienteIdRaw
  let query = supabase.from('movimenti_clienti')
    .select('id,tipo,descrizione,prezzo_unitario,quantita,iva,totale,credito_residuo,data_acquisto,created_at,clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('data_acquisto', dal)
  if (al) query = query.lte('data_acquisto', al)
  const { data } = await query
  return NextResponse.json(data || [])
}