import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Ruolo del richiedente rispetto al ticket: 'master' = lato assistenza (owner che risponde),
// 'cliente' = lato richiedente (il cliente che ha aperto, o il master che ha aperto verso la linea
// superiore). null = non è parte del ticket (non autorizzato).
async function partecipante(utente: any, ticket: any): Promise<'master' | 'cliente' | 'rete' | null> {
  if (!utente) return null
  const ruolo = String(utente.ruolo || '').toLowerCase()
  // UTENTE DEL PORTALE CLIENTE: può stare SOLO sul proprio ticket, mai su altro.
  // Anche il cliente ha un master_id (il master a cui appartiene) e coincide con
  // l'owner_master_id del ticket: senza questa uscita anticipata, aprendo il ticket di un ALTRO
  // cliente dello stesso master si cadeva nel ramo "master" più sotto e lo si leggeva tutto,
  // messaggi interni di rete compresi, potendo anche scrivere firmandosi come assistenza.
  if (ruolo === 'cliente' || utente.cliente_id) {
    return utente.cliente_id && utente.cliente_id === ticket.cliente_id ? 'cliente' : null
  }
  // AGENTE: sola lettura sui SUOI clienti e nessun dato del master o della rete (lib/agente.ts).
  // Qui non c'è modo di limitarlo al suo perimetro (i ticket non hanno un agente), quindi resta
  // fuori: prima era indistinguibile dal master e vedeva le conversazioni di tutti i clienti.
  if (ruolo === 'agente') return null
  if (utente.master_id && utente.master_id === ticket.aperto_master_id) return 'cliente'  // master che ha aperto (richiedente)
  if (utente.master_id && utente.master_id === ticket.owner_master_id) return 'master'    // lato che risponde
  // Master della CATENA a cui il ticket e' stato inoltrato: vede tutto, il cliente non lo vede.
  if (utente.master_id && Array.isArray(ticket.rete_master_ids) && ticket.rete_master_ids.includes(utente.master_id)) return 'rete'
  return null
}

// GET: dettaglio ticket + thread messaggi (chat). Accessibile a entrambe le parti.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets')
    .select('id,codice,oggetto,stato,categoria,tipo_apertura,aperto_da,cliente_id,owner_master_id,aperto_master_id,pod_url,created_at,updated_at,inoltrato_a_master_id,rete_master_ids,rete_non_letti')
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const ruolo = await partecipante(utente, t)
  if (!ruolo) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  let q = admin.from('ticket_messaggi')
    .select('id,autore,autore_nome,testo,allegati,created_at,visibilita,autore_master_id').eq('ticket_id', id).order('created_at', { ascending: true })
  // Il RICHIEDENTE (cliente o master che ha aperto) NON vede i messaggi interni della rete:
  // per lui esiste solo la conversazione con la sua assistenza diretta.
  if (ruolo === 'cliente') q = q.eq('visibilita', 'pubblico')
  const { data: messaggi } = await q
  // 'mio' calcolato lato server (il browser non conosce il proprio master_id).
  const msgOut = (messaggi || []).map((m: any) => ({
    ...m,
    mio: ruolo === 'cliente' ? m.autore === 'cliente'
      : (m.autore !== 'cliente' && (m.autore_master_id ? m.autore_master_id === utente?.master_id : ruolo === 'master' && m.autore === 'master')),
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
  const ticketOut = ruolo === 'cliente'
    ? { ...t, inoltrato_a_master_id: undefined, rete_master_ids: undefined, rete_non_letti: undefined }
    : t
  return NextResponse.json({ ticket: ticketOut, messaggi: msgOut, ruolo })
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
  const { data: t } = await admin.from('tickets').select('id,stato,cliente_id,owner_master_id,aperto_master_id,tipo_apertura,aperto_da,rete_master_ids,rete_non_letti,inoltrato_a_master_id').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const ruolo = await partecipante(utente, t)
  if (!ruolo) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (t.stato === 'chiuso') return NextResponse.json({ error: 'Questo ticket è chiuso: non è più possibile scrivere.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const testo = String(body?.testo || '').trim()
  if (!testo) return NextResponse.json({ error: 'Messaggio vuoto' }, { status: 400 })

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
    ticket_id: id, autore: ruolo, autore_nome: autoreNome, testo, visibilita,
    autore_master_id: ruolo === 'cliente' ? null : (utente?.master_id || null),
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
  await admin.from('tickets').update(upd).eq('id', id)
  return NextResponse.json({ success: true })
}

// PUT: cambia stato (incluso 'chiuso' = archiviato) o carica la POD. Solo il master owner (lato assistenza).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const ruoloUtente = (utente?.ruolo || '').toLowerCase()
  // Fuori il portale cliente e l'agente (sola lettura, niente dati del master né della rete).
  if (!masterId || ruoloUtente === 'cliente' || utente?.cliente_id || ruoloUtente === 'agente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  const admin = createAdminSupabase()

  const { data: t } = await admin.from('tickets').select('owner_master_id,rete_master_ids,rete_non_letti').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const inCatena = Array.isArray(t.rete_master_ids) && t.rete_master_ids.includes(masterId)
  const sonoOwner = t.owner_master_id === masterId
  if (!sonoOwner && !inCatena) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

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

  // Caricamento PDF della POD (base64) -> storage -> pod_url. Caricare la POD chiude la richiesta.
  if (typeof body?.podBase64 === 'string' && body.podBase64) {
    try {
      const b64 = body.podBase64.split(',').pop() || body.podBase64
      const buffer = Buffer.from(b64, 'base64')
      if (!buffer.length) return NextResponse.json({ error: 'File POD vuoto o non valido' }, { status: 400 })
      const path = `pod/${masterId}/${Date.now()}_${id}.pdf`
      const { error: upErr } = await admin.storage.from('reports').upload(path, buffer, { contentType: 'application/pdf', upsert: true })
      if (upErr) return NextResponse.json({ error: 'Upload POD fallito: ' + upErr.message }, { status: 400 })
      const { data: pub } = admin.storage.from('reports').getPublicUrl(path)
      if (!pub?.publicUrl) return NextResponse.json({ error: 'URL POD non generato' }, { status: 400 })
      upd.pod_url = pub.publicUrl
      upd.stato = 'risolto'
    } catch (e: any) {
      return NextResponse.json({ error: 'Errore caricamento POD: ' + (e?.message || 'sconosciuto') }, { status: 400 })
    }
  }

  const { error } = await admin.from('tickets').update(upd).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
