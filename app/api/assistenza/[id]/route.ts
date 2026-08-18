import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
// La regola su chi puo' stare dentro un ticket ora vive in lib/ticket-accesso.ts, perche' la usa
// anche /api/file per gli allegati e la POD: una sola definizione, nessuna copia da tenere allineata.
import { partecipanteTicket as partecipante, posizioneCatena, messaggioVisibileCatena, mascheraCatena, assegnatoPer } from '@/lib/ticket-accesso'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'
import { caricaAllegatiTicket } from '@/lib/allegati-ticket'

// GET: dettaglio ticket + thread messaggi (chat). Accessibile a entrambe le parti.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets')
    .select('id,codice,oggetto,stato,categoria,tipo_apertura,aperto_da,cliente_id,owner_master_id,aperto_master_id,pod_url,created_at,updated_at,inoltrato_a_master_id,rete_master_ids,rete_non_letti,assegnazioni')
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const ruolo = await partecipante(utente, t)
  if (!ruolo) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  let q = admin.from('ticket_messaggi')
    .select('id,autore,autore_id,autore_nome,testo,allegati,created_at,visibilita,autore_master_id').eq('ticket_id', id).order('created_at', { ascending: true })
  // Il RICHIEDENTE (cliente o master che ha aperto) NON vede i messaggi interni della rete:
  // per lui esiste solo la conversazione con la sua assistenza diretta.
  if (ruolo === 'cliente') q = q.eq('visibilita', 'pubblico')
  const { data: messaggi } = await q
  // CATENA A PIU' LIVELLI: un master della catena vede i messaggi 'rete' solo fino al proprio
  // bersaglio d'inoltro (un gradino sopra), mai oltre — così un sotto-master non scopre che il suo
  // master ha inoltrato ancora più in alto. Il cliente ha già solo i 'pubblico' (filtro SQL sopra).
  const posViewer = posizioneCatena(utente?.master_id, t)
  const messaggiVisti = ruolo === 'cliente' ? (messaggi || []) : (messaggi || []).filter((m: any) => messaggioVisibileCatena(m, posViewer, t))
  // 'mio' calcolato lato server (il browser non conosce il proprio master_id): serve al LATO del
  // fumetto (destra/arancio). 'tu' invece è l'UTENTE preciso che ha scritto — con Sara e Giuliana
  // sullo stesso master, 'mio' è vero per entrambe, ma 'tu' solo per chi guarda.
  const msgOut = messaggiVisti.map((m: any) => ({
    ...m,
    mio: ruolo === 'cliente' ? m.autore === 'cliente'
      : (m.autore !== 'cliente' && (m.autore_master_id ? m.autore_master_id === utente?.master_id : ruolo === 'master' && m.autore === 'master')),
    tu: !!m.autore_id && m.autore_id === user.id,
  }))
  // Aprendo la chat, segno letto il lato di CHI apre.
  if (ruolo === 'master') await admin.from('tickets').update({ non_letto_owner: false }).eq('id', id)
  else if (ruolo === 'cliente') await admin.from('tickets').update({ aperto_letto: true }).eq('id', id)
  else if (ruolo === 'rete') {
    const rimasti = (t.rete_non_letti || []).filter((x: string) => x !== utente?.master_id)
    await admin.from('tickets').update({ rete_non_letti: rimasti }).eq('id', id)
  }
  // Al RICHIEDENTE l'inoltro non si racconta: i messaggi interni erano già nascosti, ma i campi
  // della catena uscivano lo stesso nel corpo della risposta e bastava guardarla per scoprire
  // che la richiesta era stata girata più in alto, e a chi.
  // Al cliente: via del tutto i campi catena. Al master della catena: mascherati oltre il suo
  // bersaglio d'inoltro (vede di aver inoltrato, non a chi altro è stato girato più su).
  const ticketOut = ruolo === 'cliente'
    ? { ...t, inoltrato_a_master_id: undefined, rete_master_ids: undefined, rete_non_letti: undefined, assegnazioni: undefined }
    : { ...mascheraCatena(t, utente?.master_id), ...assegnatoPer(t, utente?.master_id), assegnazioni: undefined }
  // io_id: chi sta guardando. Serve alla chat per marcare "· tu" e all'header per capire se il
  // ticket è già in carico a me (mostra "Prendi in carico" solo se lo tiene un altro / nessuno).
  return NextResponse.json({ ticket: ticketOut, messaggi: msgOut, ruolo, io_id: user.id })
}

// POST: aggiunge un messaggio al thread. Entrambe le parti possono scrivere finché il ticket
// NON è chiuso (allora è archiviato, sola lettura).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets').select('id,stato,cliente_id,owner_master_id,aperto_master_id,tipo_apertura,aperto_da,rete_master_ids,rete_non_letti,inoltrato_a_master_id,assegnazioni').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const ruolo = await partecipante(utente, t)
  if (!ruolo) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (t.stato === 'chiuso') return NextResponse.json({ error: 'Questo ticket è chiuso: non è più possibile scrivere.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const testo = String(body?.testo || '').trim()
  // Allegati del messaggio (foto/PDF/qualsiasi file). Un messaggio può essere di solo testo, di
  // soli allegati (es. una foto), o entrambi.
  const allegatiIn = Array.isArray(body?.allegati) ? body.allegati.slice(0, 10) : []
  if (!testo && !allegatiIn.length) return NextResponse.json({ error: 'Messaggio vuoto' }, { status: 400 })
  const allegatiOut = allegatiIn.length ? await caricaAllegatiTicket(admin, utente?.master_id || t.owner_master_id || 'x', allegatiIn) : []

  // Nome autore: cliente = ragione sociale; master = nome utente o "Assistenza".
  let autoreNome = 'Assistenza'
  if (ruolo === 'cliente') {
    if ((utente as any)?.cliente_id) { const { data: cli } = await admin.from('clienti').select('ragione_sociale').eq('id', (utente as any).cliente_id).maybeSingle(); autoreNome = cli?.ragione_sociale || t.aperto_da || 'Cliente' }
    else autoreNome = [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || t.aperto_da || 'Richiedente'
  } else if (ruolo === 'rete') {
    const { data: m } = await admin.from('masters').select('nome').eq('id', utente?.master_id).maybeSingle()
    autoreNome = m?.nome || 'Rete'
  } else {
    autoreNome = [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || 'Assistenza'
  }

  // VISIBILITA': i messaggi della catena di rete sono SEMPRE interni (il cliente non li vede);
  // l'assistenza (owner) puo' scegliere 'interno' quando il ticket e' inoltrato in rete.
  const reteIds: string[] = Array.isArray(t.rete_master_ids) ? t.rete_master_ids : []
  const visibilita = ruolo === 'rete' ? 'rete' : (ruolo === 'master' && body?.interno === true && reteIds.length ? 'rete' : 'pubblico')

  const { error } = await admin.from('ticket_messaggi').insert({
    ticket_id: id, autore: ruolo, autore_id: user.id, autore_nome: autoreNome, testo, visibilita,
    autore_master_id: ruolo === 'cliente' ? null : (utente?.master_id || null),
    allegati: allegatiOut.length ? allegatiOut : null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Notifiche: chi scrive non si auto-notifica; il cliente viene toccato SOLO dai messaggi pubblici.
  const nuovoStato = t.stato === 'risolto' ? 'aperto' : t.stato
  const upd: any = { updated_at: new Date().toISOString(), stato: nuovoStato }
  const senzaMe = (ids: string[]) => Array.from(new Set(ids.filter(x => x && x !== utente?.master_id)))
  if (ruolo === 'cliente') {
    upd.non_letto_owner = true; upd.aperto_letto = true
    if (reteIds.length) upd.rete_non_letti = senzaMe(reteIds)          // la catena segue gli aggiornamenti del cliente
  } else if (ruolo === 'rete') {
    upd.non_letto_owner = true                                          // notifica l'assistenza diretta (che inoltrera' al cliente)
    if (reteIds.length) upd.rete_non_letti = senzaMe(reteIds)           // e gli altri master della catena
  } else {
    // owner/assistenza
    if (visibilita === 'pubblico') { upd.aperto_letto = false; upd.non_letto_owner = false }  // notifica il richiedente
    if (reteIds.length) upd.rete_non_letti = senzaMe(reteIds)           // la catena vede comunque il seguito
  }

  // AUTO-PRESA PER MASTER: chi risponde (owner O master della catena) prende il ticket per il PROPRIO
  // livello, se nessuno del suo master l'ha già preso. Ognuno vede solo la propria assegnazione, così
  // la presa di E&A sui ticket di rete non scende al sotto-master. Nome = la PERSONA (per la rete
  // autoreNome è il nome dell'organizzazione, non serve qui).
  const nomePersona = [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || autoreNome
  const mid = utente?.master_id
  if ((ruolo === 'master' || ruolo === 'rete') && mid && !((t.assegnazioni as any)?.[mid])) {
    upd.assegnazioni = { ...((t.assegnazioni as any) || {}), [mid]: { id: user.id, nome: nomePersona } }
  }
  await admin.from('tickets').update(upd).eq('id', id)
  return NextResponse.json({ success: true })
}

// PUT: cambia stato (incluso 'chiuso' = archiviato) o carica la POD. Solo il master owner (lato assistenza).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const masterId = utente?.master_id
  const ruoloUtente = (utente?.ruolo || '').toLowerCase()
  // Fuori il portale cliente e l'agente (sola lettura, niente dati del master né della rete).
  if (!masterId || ruoloUtente === 'cliente' || utente?.cliente_id || ruoloUtente === 'agente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  const admin = createAdminSupabase()

  const { data: t } = await admin.from('tickets').select('owner_master_id,rete_master_ids,rete_non_letti,assegnazioni').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const inCatena = Array.isArray(t.rete_master_ids) && t.rete_master_ids.includes(masterId)
  const sonoOwner = t.owner_master_id === masterId
  if (!sonoOwner && !inCatena) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const nomeUtente = [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || 'Assistenza'

  // ASSEGNAZIONE ("chi se ne occupa") PER MASTER: aggiornamento ISOLATO che NON tocca notifiche né
  // stato (assegnare non deve accendere il "Nuovo" al cliente). Ogni master (owner O della catena)
  // assegna il PROPRIO livello, nella mappa `assegnazioni` sotto la sua chiave: la presa di E&A sui
  // ticket di rete resta sua e non scende al sotto-master. (Qui siamo già owner o in catena.)
  if (body?.assegna !== undefined) {
    const mappa = { ...((t.assegnazioni as any) || {}) }
    if (body.assegna === 'io') mappa[masterId] = { id: user.id, nome: nomeUtente }
    else delete mappa[masterId]
    const { error } = await admin.from('tickets').update({ assegnazioni: mappa }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  const caricaPod = typeof body?.podBase64 === 'string' && !!body.podBase64
  // Un master della catena può SOLO caricare la POD (è il senso dell'inoltro: ce l'ha lui e la
  // mette su questa richiesta). NON deve poter cambiare stato né archiviare il ticket di un
  // cliente che non è suo: quella resta una decisione dell'assistenza diretta.
  if (!sonoOwner && !caricaPod) {
    return NextResponse.json({ error: 'Da qui puoi solo caricare la POD: lo stato lo gestisce chi ha ricevuto la richiesta.' }, { status: 403 })
  }

  const upd: any = { updated_at: new Date().toISOString(), aperto_letto: false }
  const altriInCatena = (t.rete_master_ids || []).filter((x: string) => x !== masterId)
  if (sonoOwner) {
    // La notifica dell'owner si spegne SOLO quando ha davvero evaso la richiesta caricando la
    // POD. Spegnerla a ogni salvataggio cancellava il "Nuovo" di un messaggio MAI letto: i
    // bottoni rapidi "In lavorazione"/"Segna risolto" stanno nella LISTA, non nella chat.
    if (caricaPod) upd.non_letto_owner = false
    if (altriInCatena.length) upd.rete_non_letti = altriInCatena          // la catena segue l'esito
  } else {
    upd.non_letto_owner = true                                            // avviso l'assistenza diretta
    upd.rete_non_letti = altriInCatena                                    // e tolgo me dai non letti
  }
  // 'chiuso' = archiviato (termina la chat, sola lettura). Solo l'assistenza diretta.
  if (sonoOwner && body?.stato && ['aperto', 'in_lavorazione', 'risolto', 'chiuso'].includes(body.stato)) upd.stato = body.stato

  // Caricamento POD (base64) -> storage -> pod_url. Caricare la POD chiude la richiesta.
  // PDF **o IMMAGINE** (jpg/png/webp): BRT manda FOTO, non PDF. Si conserva il tipo REALE del file
  // (prima era forzato a application/pdf, e una foto BRT veniva salvata come .pdf illeggibile).
  if (typeof body?.podBase64 === 'string' && body.podBase64) {
    try {
      // PDF o QUALSIASI immagine (image/*: jpg, png, webp, heic/heif dell'iPhone, gif, avif…).
      const m = String(body.podBase64).match(/^data:(application\/pdf|image\/[a-z0-9.+-]+);base64,(.+)$/i)
      const mime = m ? m[1].toLowerCase() : 'application/pdf'
      const b64 = m ? m[2] : (body.podBase64.split(',').pop() || body.podBase64)
      const buffer = Buffer.from(b64, 'base64')
      if (!buffer.length) return NextResponse.json({ error: 'File POD vuoto o non valido' }, { status: 400 })
      const ext = mime === 'application/pdf' ? 'pdf' : (/jpe?g/.test(mime) ? 'jpg' : ((mime.split('/')[1] || 'img').replace(/[^a-z0-9]/g, '') || 'img'))
      const path = `pod/${masterId}/${Date.now()}_${id}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType: mime, upsert: true })
      if (upErr) return NextResponse.json({ error: 'Upload POD fallito: ' + upErr.message }, { status: 400 })
      // Percorso, non URL pubblico: la POD porta nome e firma del destinatario e si scarica solo
      // passando da /api/file (vedi lib/file-riservati.ts).
      upd.pod_url = path
      upd.stato = 'risolto'
    } catch (e: any) {
      return NextResponse.json({ error: 'Errore caricamento POD: ' + (e?.message || 'sconosciuto') }, { status: 400 })
    }
  }

  // Agire su un ticket non ancora preso (in lavorazione, risolto o POD caricata) vale come prenderlo
  // in carico per il PROPRIO livello, se nessuno del proprio master l'ha già preso.
  if (sonoOwner && (upd.stato === 'in_lavorazione' || upd.stato === 'risolto' || upd.pod_url) && !((t.assegnazioni as any)?.[masterId])) {
    upd.assegnazioni = { ...((t.assegnazioni as any) || {}), [masterId]: { id: user.id, nome: nomeUtente } }
  }

  const { error } = await admin.from('tickets').update(upd).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
