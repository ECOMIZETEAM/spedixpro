import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'
import { eDiscendente } from '@/lib/rete-masters'
import { fetchAll } from '@/lib/fetch-all'
import { isAgente } from '@/lib/agente'

// Le SPESE (quello che questa pagina chiama "consumabili"): tutto ciò che viene addebitato
// fuori dalla spedizione. Restano fuori spedizioni, ricariche e abbonamenti, che hanno
// le loro liste dedicate.
const TIPI_SPESA = ['rettifica', 'giacenza', 'reso']

// Rotta dell'area MASTER: legge e scrive col client admin (RLS bypassata) filtrando per
// master_id, quindi DEVE essere chiusa a chi non è staff del master. Gli utenti del portale
// cliente hanno utenti.master_id valorizzato (è il master a cui appartengono): senza questo
// controllo un cliente vedrebbe le spese di TUTTI i clienti del master, credito residuo
// compreso, e potrebbe addebitarne altri. Il portale cliente ha la sua rotta dedicata,
// /api/cliente/reports/consumabili, già limitata al proprio cliente_id.
const STAFF_MASTER = ['master', 'admin', 'operatore']
function nonStaff(utente: any): boolean {
  return !utente?.master_id || !!utente?.cliente_id || !STAFF_MASTER.includes(String(utente?.ruolo || '').toLowerCase())
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (nonStaff(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
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

  // Il cliente addebitato DEVE essere del master che chiama. Finora lo garantiva la RLS, perche'
  // il movimento passava dal client dell'utente; ora passa dal client amministrativo (serve per
  // togliere ad `authenticated` il privilegio di scrivere clienti.credito, che permetteva a
  // qualunque cliente di ricaricarsi da solo) e il controllo va rifatto qui a mano.
  {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: cl } = await createAdminSupabase()
      .from('clienti').select('id,master_id').eq('id', clienteId).maybeSingle()
    if (!cl || (cl as any).master_id !== utente?.master_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }

  try {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    await registraMovimento(createAdminSupabase(), {
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
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome,cliente_id').eq('id', user.id).single()
  // Ogni riga porta il credito residuo: la vede solo lo staff del master. L'agente è escluso
  // come in Lista Movimenti; il cliente ha la sua rotta. Finché qui si leggeva la tabella
  // vuota il controllo non serviva, ora sì.
  if (isAgente(utente as any) || nonStaff(utente)) return NextResponse.json([])
  let clienteIdRaw = req.nextUrl.searchParams.get('clienteId')
  // Stesso accorgimento di /api/movimenti/lista: l'id del sotto-master può arrivare come
  // "m%3A<id>" e senza decodificarlo il prefisso "m:" non verrebbe riconosciuto.
  if (clienteIdRaw?.includes('%')) { try { clienteIdRaw = decodeURIComponent(clienteIdRaw) } catch {} }
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  // Riga di lista, uguale per clienti e sotto-master (la pagina si aspetta questa forma).
  // Il segno va CONSERVATO: 'rettifica' e 'reso' possono essere ACCREDITI (importo positivo,
  // es. peso reale inferiore a quello dichiarato). Con Math.abs un accredito compariva come
  // spesa e veniva SOMMATO al totale invece che sottratto. L'addebito (importo negativo)
  // resta positivo in lista, l'accredito esce negativo.
  const riga = (m: any, nome: string) => {
    const valore = -(Number(m.importo) || 0)
    return {
      id: m.id, tipo: m.tipo, descrizione: m.descrizione,
      prezzo_unitario: valore, quantita: 1, iva: 0,
      totale: valore, credito_residuo: m.saldo_dopo,
      data_acquisto: (m.created_at || '').split('T')[0], created_at: m.created_at,
      clienti: { ragione_sociale: nome },
    }
  }
  // Una rettifica su una spedizione poi ANNULLATA viene stornata (lib/annullaSpedizione scrive
  // un 'rimborso' di importo opposto): non è più dovuta e non deve restare in lista, altrimenti
  // si fattura al cliente un importo già restituito.
  const senzaStornate = async (righe: any[]) => {
    const ids = Array.from(new Set(righe.filter((m) => m.tipo === 'rettifica' && m.spedizione_id)
      .map((m) => m.spedizione_id)))
    if (!ids.length) return righe
    const stornate = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from('movimenti').select('spedizione_id')
        .in('spedizione_id', ids.slice(i, i + 200)).eq('tipo', 'rimborso')
      for (const r of (data || [])) stornate.add((r as any).spedizione_id)
    }
    return righe.filter((m) => !(m.tipo === 'rettifica' && stornate.has(m.spedizione_id)))
  }
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
    const righe = await senzaStornate(await fetchAll(() => perPeriodo(admin.from('movimenti')
      .select('id,tipo,descrizione,importo,saldo_dopo,created_at,spedizione_id').eq('master_target_id', targetMasterId))))
    return NextResponse.json(righe.map((m: any) => riga(m, sub.nome)))
  }

  // CLIENTI: le spese stanno in 'movimenti' (ci scrive la POST qui sopra, come giacenze e
  // rettifiche). Prima si leggeva 'movimenti_clienti', un registro parallelo mai popolato:
  // la Storia usciva SEMPRE vuota anche con gli addebiti regolarmente fatti.
  if (!utente?.master_id) return NextResponse.json([])
  const clienteId = clienteIdRaw
  const righe = await senzaStornate(await fetchAll(() => {
    let q = admin.from('movimenti').select('id,tipo,descrizione,importo,saldo_dopo,created_at,cliente_id,spedizione_id')
      .eq('master_id', utente.master_id).not('cliente_id', 'is', null)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    return perPeriodo(q)
  }))
  const ids = Array.from(new Set(righe.map((m: any) => m.cliente_id).filter(Boolean)))
  const nomi = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: cli } = await admin.from('clienti').select('id,ragione_sociale').in('id', ids.slice(i, i + 300))
    for (const c of (cli || [])) nomi.set(c.id, c.ragione_sociale)
  }
  return NextResponse.json(righe.map((m: any) => riga(m, nomi.get(m.cliente_id) || '—')))
}