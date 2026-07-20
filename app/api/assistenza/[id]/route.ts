import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Ruolo del richiedente rispetto al ticket: 'master' = lato assistenza (owner che risponde),
// 'cliente' = lato richiedente (il cliente che ha aperto, o il master che ha aperto verso la linea
// superiore). null = non è parte del ticket (non autorizzato).
async function partecipante(utente: any, ticket: any): Promise<'master' | 'cliente' | null> {
  if (!utente) return null
  // IMPORTANTE: un utente CLIENTE ha anche un master_id (il suo master), che coincide con
  // l'owner_master_id del ticket → va controllato PRIMA il lato cliente, altrimenti il cliente
  // verrebbe scambiato per "master" e i suoi messaggi apparirebbero come scritti dall'assistenza.
  if (utente.cliente_id && utente.cliente_id === ticket.cliente_id) return 'cliente'      // cliente che ha aperto
  if (utente.master_id && utente.master_id === ticket.aperto_master_id) return 'cliente'  // master che ha aperto (richiedente)
  if (utente.master_id && utente.master_id === ticket.owner_master_id) return 'master'    // lato che risponde
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
    .select('id,codice,oggetto,stato,categoria,tipo_apertura,aperto_da,cliente_id,owner_master_id,aperto_master_id,pod_url,created_at,updated_at')
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const ruolo = await partecipante(utente, t)
  if (!ruolo) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { data: messaggi } = await admin.from('ticket_messaggi')
    .select('id,autore,autore_nome,testo,allegati,created_at').eq('ticket_id', id).order('created_at', { ascending: true })
  // Aprendo la chat, segno letto il lato di CHI apre: l'assistenza (owner) o il richiedente.
  await admin.from('tickets').update(ruolo === 'master' ? { non_letto_owner: false } : { aperto_letto: true }).eq('id', id)
  return NextResponse.json({ ticket: t, messaggi: messaggi || [], ruolo })
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
  const { data: t } = await admin.from('tickets').select('id,stato,cliente_id,owner_master_id,aperto_master_id,tipo_apertura,aperto_da').eq('id', id).maybeSingle()
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
  } else {
    autoreNome = [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || 'Assistenza'
  }

  const { error } = await admin.from('ticket_messaggi').insert({ ticket_id: id, autore: ruolo, autore_nome: autoreNome, testo })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Notifica il lato che NON ha scritto; se era "risolto" torna "aperto" con la nuova risposta.
  const nuovoStato = t.stato === 'risolto' ? 'aperto' : t.stato
  const upd: any = { updated_at: new Date().toISOString(), stato: nuovoStato }
  if (ruolo === 'cliente') { upd.non_letto_owner = true; upd.aperto_letto = true }   // scrive il RICHIEDENTE → notifica l'assistenza
  else { upd.aperto_letto = false; upd.non_letto_owner = false }                     // scrive l'ASSISTENZA → notifica il richiedente
  await admin.from('tickets').update(upd).eq('id', id)
  return NextResponse.json({ success: true })
}

// PUT: cambia stato (incluso 'chiuso' = archiviato) o carica la POD. Solo il master owner (lato assistenza).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const masterId = utente?.master_id
  if (!masterId || (utente?.ruolo || '').toLowerCase() === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  const admin = createAdminSupabase()

  const { data: t } = await admin.from('tickets').select('owner_master_id').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  if (t.owner_master_id !== masterId) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const upd: any = { updated_at: new Date().toISOString(), aperto_letto: false }
  // 'chiuso' = archiviato (termina la chat, sola lettura).
  if (body?.stato && ['aperto', 'in_lavorazione', 'risolto', 'chiuso'].includes(body.stato)) upd.stato = body.stato

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
