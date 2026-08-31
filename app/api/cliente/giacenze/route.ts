import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS_CLIENTE } from '@/lib/spedizioni-cols'
import { createAdminSupabase } from '@/lib/supabase-admin'
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
  // Colonne scelte a mano, mai `*`: la RLS limita le RIGHE alle sue spedizioni, non le COLONNE.
  // Con `*` al cliente arrivavano costo_spedizione (il costo del master, quindi il suo margine),
  // raw_response (la risposta grezza del provider tecnico) e l'etichetta in base64, ~150 kB a riga.
  let query = supabase.from('spedizioni')
    .select(SPED_COLS_CLIENTE + ',clienti(ragione_sociale),corrieri(nome_contratto)')
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
  // Client ADMIN solo per questa lettura, perche' porta dentro le credenziali del contratto: non
  // devono essere leggibili col token del cliente. Il filtro .eq('cliente_id', clienteId) tiene il
  // perimetro esattamente com'era — la spedizione dev'essere sua.
  const { data: spedizione } = await createAdminSupabase().from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(tipo,credenziali,nome_contratto)')
    .eq('id', spedizioneId).eq('cliente_id', clienteId).single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  if (azione === 'svincola') {
    // PORTA UNICA: lo svincolo del cliente passa dallo STESSO motore del master (lib/giacenza-svincolo).
    // Prima questa rotta duplicava la logica ed era rotta: (1) NON gestiva SpediamoPro (mancava il ramo
    // authcode) -> il cliente marcava "svincolata" senza mai chiamare SpediamoPro, e il pacco restava in
    // giacenza dal corriere (fonte delle "ferme"); (2) gli errori corriere (DVA/Spedisci) erano solo
    // loggati -> "svincolata" anche se il corriere rifiutava. Ora: eseguiSvincolo chiama DAVVERO il
    // corriere (tutti e 3 i provider), BLOCCA se rifiuta (niente svincolata finta), addebita a cascata
    // IDENTICO al master, e marca la spedizione (una riga sola -> lo stato si aggiorna per cliente e per
    // TUTTI i master della catena che la vedono). Il cliente svincola in AUTONOMIA (riconsegna al
    // destinatario); reso / nuovo indirizzo restano scelte del master.
    const admin = createAdminSupabase()
    const { leggiPrezzi, calcolaCosti, noloClienteSpedizione } = await import('@/lib/giacenza-prezzi')
    const { eseguiSvincolo } = await import('@/lib/giacenza-svincolo')
    const prezzi = await leggiPrezzi(admin, spedizione)
    const costi = calcolaCosti('riconsegna', prezzi, spedizione, await noloClienteSpedizione(admin, spedizione))
    const { data: rich, error: eRich } = await admin.from('giacenza_richieste').insert({
      spedizione_id: spedizioneId, master_id: spedizione.master_id, cliente_id: spedizione.cliente_id,
      operazione: 'riconsegna', note: istruzioni || null, ...costi,
      richiesta_da: 'cliente', creata_da: 'Cliente', stato: 'da_confermare',
    }).select('*').single()
    if (eRich || !rich) return NextResponse.json({ error: 'Richiesta svincolo non creata' }, { status: 400 })
    try {
      const { addebito, avviso } = await eseguiSvincolo(admin, spedizione, rich, 'Cliente')
      return NextResponse.json({ success: true, costoAddebitato: addebito, avviso })
    } catch (e: any) {
      // Corriere ha rifiutato: annullo la richiesta e NON marco svincolata (niente svincolata finta).
      await admin.from('giacenza_richieste').update({ stato: 'annullata' }).eq('id', rich.id)
      return NextResponse.json({ error: e?.message || 'Svincolo non riuscito' }, { status: 400 })
    }
  }
  if (azione === 'chiudi') {
    await supabase.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', spedizioneId)
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}