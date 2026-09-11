import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { SPED_COLS } from '@/lib/spedizioni-cols'

// Elenco giacenze (lista master). La GESTIONE (svincolo/riconsegna/reso/nuovo indirizzo + addebito)
// NON sta più qui: passa dalla porta unica eseguiSvincolo via /api/giacenze/[id] (dettaglio), il
// portale cliente (/api/cliente/giacenze) e l'API v1. Il vecchio POST di questa rotta — svincolo
// rapido a sola "riconsegna", senza scelta reso/nuovo indirizzo e con un costo giornaliero mai
// addebitato — era rimasto agganciato solo a un modal ORMAI MORTO della lista: rimosso (11/09/2026).

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const vettore = p.get('vettore')
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')

  let db: any = supabase
  let subtreeSel: string[] | null = null
  if (masterSel && vedeLaRete(utente)) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  // Elencare "cliente per cliente" i ruoli esclusi a mano (agente, cliente) lasciava dentro
  // l'AUTISTA, che un master_id ce l'ha come tutti: con l'accesso pieno vedeva le giacenze
  // dell'intera rete, prezzi e clienti compresi. La regola sta in lib/perimetro.ts, dove e' una
  // sola e non si dimentica un ruolo per volta.
  } else if (vedeLaRete(utente)) {
    // MASTER: le giacenze risalgono a TUTTA la rete (come Elenco Spedizioni/volumetria), non solo
    // le proprie: prima si vedeva solo master_id === il mio, quindi le giacenze dei sotto-master
    // (es. Ecomize LL) non comparivano.
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    subtreeSel = await sottoAlberoMasterIds(adminDb, utente.master_id)
    if (subtreeSel.length > 1) db = adminDb
  }

  // Filtro "è entrata in giacenza" (giacenza_data valorizzata), NON lo stato corrente: dopo lo
  // svincolo il cron sposta spedizioni.stato (in_giacenza -> non_consegnato/in_consegna) ma la
  // giacenza deve RESTARE in elenco (con giacenza_stato = svincolata/chiusa). Prima spariva.
  // Colonne LEGGERE (SPED_COLS): niente etichetta_url/raw_response/colli_dettaglio (~300 KB/riga di
  // blob PDF/base64). Includono già tutti i campi giacenza_* che la pagina usa. Era `*`: su una rete
  // con molte giacenze la lista trasferiva decine di MB → "veramente lenta". La rotta cliente lo faceva già.
  let query = db.from('spedizioni')
    .select(`${SPED_COLS}, clienti(ragione_sociale), corrieri(nome_contratto)`)
    .not('giacenza_data', 'is', null)
    .order('giacenza_data', { ascending: false })

  if (subtreeSel) query = query.in('master_id', subtreeSel)
  else query = query.eq('master_id', utente?.master_id)
  // Agente: solo giacenze dei suoi clienti (copre anche l'eventuale ramo rete).
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (clienteId) query = query.eq('cliente_id', clienteId)
  // 'aperta' = in attesa di istruzioni: le giacenze appena rilevate hanno giacenza_stato NULL
  // (il rilevamento valorizza solo giacenza_data) -> il confronto esatto le escludeva dal filtro.
  if (stato === 'aperta') query = query.or('giacenza_stato.eq.aperta,giacenza_stato.is.null')
  else if (stato) query = query.eq('giacenza_stato', stato)
  // Filtro per la data di ENTRATA in giacenza (giacenza_data), non per la data di spedizione
  // (created_at): una giacenza può nascere oggi da una spedizione creata giorni fa, e col filtro
  // su created_at (default oggi) non compariva. Fallback su created_at per righe legacy senza data.
  if (dal) query = query.or(`giacenza_data.gte.${dal},and(giacenza_data.is.null,created_at.gte.${dal})`)
  if (al) query = query.or(`giacenza_data.lte.${al}T23:59:59,and(giacenza_data.is.null,created_at.lte.${al}T23:59:59)`)

  const { data } = await query
  return NextResponse.json(data || [])
}
