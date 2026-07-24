import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const p = req.nextUrl.searchParams
  const stato = p.get('stato'); const dal = p.get('dal'); const al = p.get('al')
  // Una giacenza resta in elenco ANCHE dopo lo svincolo: il cron sposta spedizioni.stato
  // (es. in_giacenza -> non_consegnato), ma resta `giacenza_data` valorizzata e `giacenza_stato`
  // (aperta/in_gestione/svincolata/chiusa). Quindi filtro per "è entrata in giacenza", non per lo
  // stato corrente della spedizione. Data filtrata su giacenza_data (quando è entrata in giacenza).
  let query = supabase.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .eq('cliente_id', clienteId)
    .not('giacenza_data', 'is', null)
    .order('giacenza_data', { ascending: false })
  // 'aperta' = in attesa di istruzioni: le giacenze appena rilevate hanno giacenza_stato NULL
  // (il rilevamento valorizza solo giacenza_data) -> il confronto esatto le escludeva dal filtro.
  if (stato === 'aperta') query = query.or('giacenza_stato.eq.aperta,giacenza_stato.is.null')
  else if (stato) query = query.eq('giacenza_stato', stato)
  if (dal) query = query.gte('giacenza_data', dal)
  if (al) query = query.lte('giacenza_data', al + 'T23:59:59')
  const { data } = await query
  return NextResponse.json(data || [])
}
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const body = await req.json()
  const { spedizioneId, istruzioni, azione } = body
  const { data: spedizione } = await supabase.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(credenziali,nome_contratto)')
    .eq('id', spedizioneId).eq('cliente_id', clienteId).single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  const dataGiacenza = spedizione.giacenza_data ? new Date(spedizione.giacenza_data) : new Date(spedizione.created_at)
  const giorni = Math.max(1, Math.ceil((new Date().getTime() - dataGiacenza.getTime()) / (1000*60*60*24)))
  const costoGiornaliero = parseFloat(spedizione.giacenza_costo_giornaliero || 0)
  const costoRiconsegna = parseFloat(spedizione.giacenza_costo_riconsegna || 0)
  const costoTotale = (costoGiornaliero * giorni) + costoRiconsegna
  if (azione === 'svincola') {
    const cred = spedizione.corrieri?.credenziali as Record<string,string>
    if (cred?.master_domain && cred?.password) {
      try {
        await fetch(`https://${cred.master_domain}/api/v2/shipping/delivery-instructions/${spedizione.tracking_number}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: istruzioni || 'Riconsegnare al destinatario' })
        })
      } catch(e) { console.error('Errore svincolo corriere:', e) }
    }
    await supabase.from('spedizioni').update({
      giacenza_stato: 'svincolata', giacenza_istruzioni: istruzioni, giacenza_giorni: giorni, stato: 'in_consegna'
    }).eq('id', spedizioneId)
    // Addebito SVINCOLO (servizio riconsegna) UNIFICATO: cascata rete su `movimenti` (non più
    // movimenti_clienti). L'apertura è già addebitata all'entrata. Guard giacenza_addebito_effettuato.
    if (!spedizione.giacenza_addebito_effettuato) {
      const { addebitaServizioGiacenza } = await import('@/lib/giacenza-cascata')
      await addebitaServizioGiacenza(
        { id: spedizioneId, numero: spedizione.numero, cliente_id: spedizione.cliente_id, master_id: spedizione.master_id, corriere_id: spedizione.corriere_id },
        'riconsegna', costoRiconsegna
      )
      await supabase.from('spedizioni').update({ giacenza_addebito_effettuato: true }).eq('id', spedizioneId)
    }
    return NextResponse.json({ success: true, costoAddebitato: costoRiconsegna, giorni })
  }
  if (azione === 'chiudi') {
    await supabase.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', spedizioneId)
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}