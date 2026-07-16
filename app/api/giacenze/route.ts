import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'
import { spediamoproSearchStocks, spediamoproReleaseStock } from '@/lib/spediamopro'

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
  if (masterSel && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  } else if (utente?.master_id && !isAgente(utente) && utente?.ruolo !== 'cliente') {
    // MASTER: le giacenze risalgono a TUTTA la rete (come Elenco Spedizioni/volumetria), non solo
    // le proprie: prima si vedeva solo master_id === il mio, quindi le giacenze dei sotto-master
    // (es. Ecomize LL) non comparivano.
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    subtreeSel = await sottoAlberoMasterIds(adminDb, utente.master_id)
    if (subtreeSel.length > 1) db = adminDb
  }

  let query = db.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .eq('stato', 'in_giacenza')
    .order('created_at', { ascending: false })

  if (subtreeSel) query = query.in('master_id', subtreeSel)
  else query = query.eq('master_id', utente?.master_id)
  // Agente: solo giacenze dei suoi clienti (copre anche l'eventuale ramo rete).
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (stato) query = query.eq('giacenza_stato', stato)
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
  const body = await req.json()
  const { spedizioneId, istruzioni, azione } = body

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
          // releaseAction 1 = riconsegna allo stesso indirizzo (default). instructions opzionale.
          await spediamoproReleaseStock(cred.authcode, Number(attivo.id), 1, istruzioni ? { instructions: istruzioni } : {})
        }
      } catch (e) { console.error('Errore svincolo SpediamoPro:', e) }
    } else if (cred?.master_domain && cred?.password) {
      // Spedisci.online: delivery-instructions
      try {
        await fetch(`https://${cred.master_domain}/api/v2/shipping/delivery-instructions/${spedizione.tracking_number}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: istruzioni || 'Riconsegnare al destinatario' })
        })
      } catch(e) { console.error('Errore svincolo corriere:', e) }
    }

    // Aggiorna stato spedizione (admin: può essere di un sotto-master della rete)
    await adminDb.from('spedizioni').update({
      giacenza_stato: 'svincolata',
      giacenza_istruzioni: istruzioni,
      giacenza_giorni: giorni,
      stato: 'in_consegna'
    }).eq('id', spedizioneId)

    // Addebita costi al cliente se > 0 e non già addebitato. L'addebito va al master PROPRIETARIO
    // della spedizione (spedizione.master_id), non al master loggato: per le giacenze di rete il
    // costo è del sotto-master/cliente a cui appartiene la spedizione.
    if (costoTotale > 0 && !spedizione.giacenza_addebito_effettuato) {
      await adminDb.from('movimenti_clienti').insert({
        master_id: spedizione.master_id,
        cliente_id: spedizione.cliente_id,
        tipo: 'addebito',
        descrizione: `Giacenza spedizione ${spedizione.numero} (${giorni} giorni) + riconsegna`,
        prezzo_unitario: costoTotale,
        quantita: 1,
        iva: 22,
        importo: costoTotale,
        totale_iva: costoTotale * 0.22,
        totale: costoTotale * 1.22,
        data_acquisto: new Date().toISOString().split('T')[0],
      })
      await adminDb.from('spedizioni').update({ giacenza_addebito_effettuato: true }).eq('id', spedizioneId)
    }

    return NextResponse.json({ success: true, costoAddebitato: costoTotale, giorni })
  }

  if (azione === 'chiudi') {
    await adminDb.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', spedizioneId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}