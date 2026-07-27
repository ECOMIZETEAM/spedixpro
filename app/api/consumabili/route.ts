import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'
import { eDiscendente } from '@/lib/rete-masters'
import { fetchAll } from '@/lib/fetch-all'

// Le SPESE (quello che questa pagina chiama "consumabili"): tutto ciò che viene addebitato
// fuori dalla spedizione. Restano fuori spedizioni, ricariche e abbonamenti, che hanno
// le loro liste dedicate.
const TIPI_SPESA = ['rettifica', 'giacenza', 'reso']

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

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  // Riga di lista, uguale per clienti e sotto-master (la pagina si aspetta questa forma).
  const riga = (m: any, nome: string) => ({
    id: m.id, tipo: m.tipo, descrizione: m.descrizione,
    prezzo_unitario: Math.abs(Number(m.importo) || 0), quantita: 1, iva: 0,
    totale: Math.abs(Number(m.importo) || 0), credito_residuo: m.saldo_dopo,
    data_acquisto: (m.created_at || '').split('T')[0], created_at: m.created_at,
    clienti: { ragione_sociale: nome },
  })
  const perPeriodo = (q: any) => {
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q.in('tipo', TIPI_SPESA).order('created_at', { ascending: false })
  }

  // Storia di un SOTTO-MASTER (clienteId = "m:<id>"): dai movimenti tra master.
  // Vale per TUTTA la rete sotto di me, non solo per i figli diretti: da un nodo alto la
  // storia di un sotto-master di secondo livello tornava vuota senza alcun motivo visibile.
  if (clienteIdRaw && clienteIdRaw.startsWith('m:')) {
    const targetMasterId = clienteIdRaw.slice(2)
    const { data: sub } = await admin.from('masters').select('id,parent_master_id,nome').eq('id', targetMasterId).maybeSingle()
    if (!sub || !(await eDiscendente(admin, targetMasterId, utente?.master_id))) return NextResponse.json([])
    const righe = await fetchAll(() => perPeriodo(admin.from('movimenti')
      .select('id,tipo,descrizione,importo,saldo_dopo,created_at').eq('master_target_id', targetMasterId)))
    return NextResponse.json(righe.map((m: any) => riga(m, sub.nome)))
  }

  // CLIENTI: le spese stanno in 'movimenti' (ci scrive la POST qui sopra, come giacenze e
  // rettifiche). Prima si leggeva 'movimenti_clienti', un registro parallelo mai popolato:
  // la Storia usciva SEMPRE vuota anche con gli addebiti regolarmente fatti.
  if (!utente?.master_id) return NextResponse.json([])
  const clienteId = clienteIdRaw
  const righe = await fetchAll(() => {
    let q = admin.from('movimenti').select('id,tipo,descrizione,importo,saldo_dopo,created_at,cliente_id')
      .eq('master_id', utente.master_id).not('cliente_id', 'is', null)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    return perPeriodo(q)
  })
  const ids = Array.from(new Set(righe.map((m: any) => m.cliente_id).filter(Boolean)))
  const nomi = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: cli } = await admin.from('clienti').select('id,ragione_sociale').in('id', ids.slice(i, i + 300))
    for (const c of (cli || [])) nomi.set(c.id, c.ragione_sociale)
  }
  return NextResponse.json(righe.map((m: any) => riga(m, nomi.get(m.cliente_id) || '—')))
}