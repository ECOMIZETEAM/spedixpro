import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'
import { spediamoproSearchStocks, spediamoproReleaseStock } from '@/lib/spediamopro'
import { vedeLaRete } from '@/lib/perimetro'
import { SPED_COLS } from '@/lib/spedizioni-cols'

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

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura

  // LE GIACENZE DELLA RETE LE GESTISCE CHI LA RETE LA VEDE.
  // Il controllo piu' sotto e' "la spedizione sta nel sotto-albero del MIO master": corretto per un
  // master, rovinoso per un cliente — che un master_id ce l'ha anche lui, tutti e 634. E siccome
  // questa rotta legge e scrive con l'accesso pieno, le regole per-inquilino non lo fermavano: un
  // cliente qualsiasi poteva svincolare o chiudere la giacenza di QUALUNQUE spedizione della rete
  // del suo master — non solo le proprie — facendo partire la chiamata al corriere e l'addebito su
  // tutta la catena. Il cliente la sua giacenza la CHIEDE, da /api/giacenze/[id]: e' li' che il
  // master la conferma.
  // Il portale cliente questa rotta non la chiama affatto: la usa solo la dashboard del master.
  if (!vedeLaRete(utente)) {
    return NextResponse.json({ error: 'Operazione riservata al master.' }, { status: 403 })
  }

  const body = await req.json()
  const { spedizioneId, istruzioni, azione, releaseAction } = body

  // Il master gestisce le giacenze di TUTTA la sua rete (non solo le proprie): autorizzo sul
  // sotto-albero e uso l'admin per leggere/scrivere cross-master (come per la visibilità in GET).
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const adminDb = createAdminSupabase()
  const subtree = utente?.master_id ? await sottoAlberoMasterIds(adminDb, utente.master_id) : []

  // Carica spedizione (deve appartenere alla mia rete)
  const { data: spedizione } = await adminDb.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(credenziali,nome_contratto,tipo)')
    .eq('id', spedizioneId).in('master_id', subtree.length ? subtree : ['00000000-0000-0000-0000-000000000000']).single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Calcola giorni giacenza e costi
  const dataGiacenza = spedizione.giacenza_data ? new Date(spedizione.giacenza_data) : new Date(spedizione.created_at)
  const giorni = Math.max(1, Math.ceil((new Date().getTime() - dataGiacenza.getTime()) / (1000 * 60 * 60 * 24)))
  const costoGiornaliero = parseFloat(spedizione.giacenza_costo_giornaliero || 0)
  const costoRiconsegna = parseFloat(spedizione.giacenza_costo_riconsegna || 0)
  const costoTotale = (costoGiornaliero * giorni) + costoRiconsegna

  if (azione === 'svincola') {
    // Chiama l'API del corriere per svincolare
    const cred = spedizione.corrieri?.credenziali as Record<string,string>
    const tipoCorr = spedizione.corrieri?.tipo
    if (tipoCorr === 'spediamopro' && cred?.authcode) {
      // SpediamoPro: cerca lo stock attivo della spedizione e lo rilascia
      try {
        const raw: any = spedizione.raw_response || {}
        const spid = raw.id || raw?.raw?.data?.id
        const code = raw.code || raw?.raw?.data?.code || spedizione.tracking_number
        const stocks = await spediamoproSearchStocks(cred.authcode, String(code))
        const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && (!spid || Number(st.shipmentId) === Number(spid)))
        if (attivo?.id) {
          // releaseAction: 1 = riconsegna stesso indirizzo (default), 3 = reso al mittente. Serve al
          // "Ri-svincola" del Controllo Giacenze: le re-giacenze (2° fallimento consegna) spesso vanno a
          // RESO. instructions opzionale. Nota: l'addebito e' gia' stato fatto (guard sotto) -> il
          // ri-svincolo non ri-addebita.
          const ra = Number(releaseAction) === 3 ? 3 : 1
          await spediamoproReleaseStock(cred.authcode, Number(attivo.id), ra, istruzioni ? { instructions: istruzioni } : {})
        }
      } catch (e) { console.error('Errore svincolo SpediamoPro:', e) }
    } else if (tipoCorr === 'easyparcel' && cred?.apikey) {
      // Contratto V: anche questa strada deve arrivare al corriere, altrimenti il pacco resta
      // fermo in deposito mentre da noi risulta svincolato. Qui l'azione e' sempre la riconsegna
      // al destinatario, come nel ramo dell'altro contratto qui sopra.
      try {
        const { easyparcelSvincolo } = await import('@/lib/easyparcel')
        await easyparcelSvincolo(cred.apikey, String(spedizione.numero || spedizione.tracking_number), 'D', {
          note: istruzioni || 'Riconsegnare al destinatario',
          telefonoDestinatario: spedizione.dest_telefono || '',
        })
      } catch (e) { console.error('Errore svincolo contratto V:', e) }
    } else if (cred?.master_domain && cred?.password && (spedizione.tracking_number || spedizione.numero)) {
      // Spedisci.online: rilascio giacenza via /api/v2/stock/update (endpoint corretto; il vecchio
      // /shipping/delivery-instructions dava 404, il pacco restava fermo). Qui è sempre riconsegna = RETRY.
      try {
        const oggi = new Date()
        const sched = `${String(oggi.getDate()).padStart(2, '0')}/${String(oggi.getMonth() + 1).padStart(2, '0')}/${oggi.getFullYear()}`
        await fetch(`https://${cred.master_domain}/api/v2/stock/update`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ldv: String(spedizione.tracking_number || spedizione.numero), action: 'RETRY', scheduled_at: sched, note: (istruzioni || 'Riconsegnare al destinatario').slice(0, 200) })
        })
      } catch(e) { console.error('Errore svincolo Spedisci:', e) }
    }

    // Aggiorna stato spedizione (admin: può essere di un sotto-master della rete)
    await adminDb.from('spedizioni').update({
      giacenza_stato: 'svincolata',
      giacenza_istruzioni: istruzioni,
      giacenza_giorni: giorni,
      stato: 'in_consegna'
    }).eq('id', spedizioneId)

    // Addebito SVINCOLO (servizio riconsegna) — UNIFICATO col flusso corretto: usa la cascata rete
    // (lib/giacenza-cascata) sulla tabella `movimenti`, non più `movimenti_clienti` senza cascata.
    // L'APERTURA è già stata addebitata all'ENTRATA in giacenza (cron). Guard giacenza_addebito_effettuato.
    if (!spedizione.giacenza_addebito_effettuato) {
      const { addebitaServizioGiacenza } = await import('@/lib/giacenza-cascata')
      await addebitaServizioGiacenza(
        { id: spedizioneId, numero: spedizione.numero, cliente_id: spedizione.cliente_id, master_id: spedizione.master_id, corriere_id: spedizione.corriere_id },
        'riconsegna', costoRiconsegna
      )
      await adminDb.from('spedizioni').update({ giacenza_addebito_effettuato: true }).eq('id', spedizioneId)
    }

    return NextResponse.json({ success: true, costoAddebitato: costoRiconsegna, giorni })
  }

  if (azione === 'chiudi') {
    await adminDb.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', spedizioneId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}