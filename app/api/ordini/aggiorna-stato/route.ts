import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { spedizioneAttiva } from '@/lib/guardia-doppione'

const STATI = ['da_spedire', 'spedito', 'errore', 'archiviato']

// Quanto indietro si cerca la spedizione di una creazione di cui la pagina non ha avuto risposta.
// La creazione dura al massimo un minuto (maxDuration di /api/spedizioni/crea) e la pagina chiede
// subito dopo: quindici minuti bastano, e tengono fuori le spedizioni vecchie dello stesso ordine.
const FINESTRA_VERIFICA_MS = 15 * 60 * 1000
// Margine sull'istante d'invio dichiarato dalla pagina (latenza di rete, orologi diversi).
const MARGINE_INVIO_MS = 10 * 1000

// LA SPEDIZIONE NATA DA QUESTO ORDINE, se c'e'. Serve quando "Spedisci selezionati" non ha ricevuto
// la risposta della creazione: pagina ricaricata o cambiata a meta', connessione caduta, risposta
// che non e' JSON. Il server la creazione la finisce comunque, e la addebita. Fino al 19/10/2026
// l'ordine finiva "in errore" col testo del browser ("Failed to fetch"): in novanta giorni 33 ordini
// su 34 avevano invece la spedizione creata, scollegata dall'ordine e pronta a partire una seconda
// volta (la guardia anti-doppione ferma solo i riferimenti "affidabili").
//
// Si riconosce dai dati che la pagina ha mandato alla creazione, che li salva cosi' come arrivano:
// stesso cliente, stesso CAP, stesso destinatario, stesso riferimento ordine (vuoto se l'ordine non
// ne ha), creata negli ultimi minuti e dopo l'import, ancora attiva, e non gia' legata a un altro
// ordine. Il destinatario si confronta SEMPRE: un riferimento riusato a mano ("AMAZON", "tabar")
// sullo stesso CAP non basta a dire che il pacco e' di questo ordine.
// `trascorsiMs` (se la pagina lo manda) = da quanto e' partita la creazione: si cerca solo cio' che
// e' nato dopo, con qualche secondo di margine per la latenza. Senza, una spedizione di un ordine
// gemello creata pochi minuti prima e rimasta scollegata verrebbe presa per questa.
async function spedizioneDellOrdine(supabase: any, clienteId: string, ordineId: string, trascorsiMs: number | null): Promise<{ id: string; numero: string } | null> {
  const { data: ord } = await supabase.from('ordini_importati')
    .select('order_id,cap,destinatario,created_at').eq('id', ordineId).eq('cliente_id', clienteId).maybeSingle()
  if (!ord) return null
  const daInvio = trascorsiMs != null ? Date.now() - Math.min(trascorsiMs, FINESTRA_VERIFICA_MS) - MARGINE_INVIO_MS : 0
  const dal = new Date(Math.max(new Date(ord.created_at).getTime() || 0, Date.now() - FINESTRA_VERIFICA_MS, daInvio)).toISOString()
  let q = supabase.from('spedizioni').select('id,numero,stato,cancellata_il')
    .eq('cliente_id', clienteId).eq('dest_cap', String(ord.cap ?? '')).gte('created_at', dal)
    .eq('dest_nome', String(ord.destinatario ?? ''))
  // La creazione salva `rifOrdine || null`: senza numero d'ordine il riferimento resta vuoto.
  const rif = String(ord.order_id ?? '')
  q = rif ? q.eq('rif_ordine', rif) : q.is('rif_ordine', null)
  const { data: candidate } = await q.order('created_at', { ascending: false }).limit(5)
  for (const s of (candidate || []).filter(spedizioneAttiva)) {
    const { data: altri } = await supabase.from('ordini_importati')
      .select('id').eq('spedizione_id', s.id).neq('id', ordineId).limit(1)
    if (altri?.length) continue
    return { id: s.id, numero: s.numero }
  }
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { id, stato, errore, numero, spedizione_id, verifica, trascorsiMs } = await req.json()
  if (!id || !STATI.includes(stato)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // ESITO SCONOSCIUTO (verifica): prima di scrivere l'errore si guarda se la spedizione e' nata lo
  // stesso. Se c'e', l'ordine diventa spedito e si collega: e' cio' che e' successo davvero.
  if (verifica === true && stato === 'errore') {
    // Gia' spedito e collegato nel frattempo (un'altra scheda, la matita): quello e' l'esito vero, e
    // un "errore" scritto sopra lo rimetterebbe fra gli ordini da rispedire.
    const { data: ora } = await supabase.from('ordini_importati')
      .select('stato,spedizione_id').eq('id', id).eq('cliente_id', utente.cliente_id).maybeSingle()
    if (ora?.stato === 'spedito' && ora.spedizione_id) return NextResponse.json({ ok: true, collegata: true })
    const t = Number(trascorsiMs)
    const trovata = await spedizioneDellOrdine(supabase, utente.cliente_id, String(id), Number.isFinite(t) && t >= 0 ? t : null)
    if (trovata) {
      const { error } = await supabase
        .from('ordini_importati')
        .update({ stato: 'spedito', errore: null, spedizione_id: trovata.id })
        .eq('id', id)
        .eq('cliente_id', utente.cliente_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, collegata: trovata.numero })
    }
  }

  const patch: Record<string, any> = {
    stato,
    errore: stato === 'errore' ? (errore || 'Errore sconosciuto') : null,
  }

  // COLLEGA LA SPEDIZIONE CREATA. Per id, se la pagina lo manda (la creazione lo restituisce): il
  // numero puo' non trovarla, per esempio se nel frattempo un numero provvisorio e' diventato quello
  // vero, e un ordine "spedito" senza spedizione collegata e' fuori dalle protezioni (la verifica
  // qui sopra salta le spedizioni gia' legate a un altro ordine guardando proprio il collegamento).
  // L'id arriva dal browser: vale solo se la spedizione e' di questo cliente.
  if (spedizione_id && stato === 'spedito') {
    const { data: sped } = await supabase
      .from('spedizioni').select('id')
      .eq('id', String(spedizione_id))
      .eq('cliente_id', utente.cliente_id)
      .maybeSingle()
    if (sped?.id) patch.spedizione_id = sped.id
  }
  // Senza id (o con un id che non e' suo), best-effort per numero.
  if (!patch.spedizione_id && numero && stato === 'spedito') {
    const { data: sped } = await supabase
      .from('spedizioni').select('id')
      .eq('cliente_id', utente.cliente_id)
      .eq('numero', numero)
      .limit(1).maybeSingle()
    if (sped?.id) patch.spedizione_id = sped.id
  }

  const { error } = await supabase
    .from('ordini_importati')
    .update(patch)
    .eq('id', id)
    .eq('cliente_id', utente.cliente_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
