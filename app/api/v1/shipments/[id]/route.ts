import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { trovaOwnerContratto } from '@/lib/annullaSpedizione'
import { registraAudit } from '@/lib/audit'
import { ritiroInRisposta } from '@/lib/ritiro-api'
import { codiceRitiroValido } from '@/lib/easyparcel'

// Dettaglio/stato di una spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    // rif_ordine anche qui: chi si integra legge la lista e poi il dettaglio, e in entrambi i posti
    // deve poter riagganciare la spedizione all'ordine del proprio gestionale (6/10/2026).
    .select('id,numero,tracking_number,rif_ordine,stato,costo_totale,dest_nome,dest_citta,dest_provincia,dest_cap,dest_paese,peso_reale,colli,contrassegno,note,created_at,cliente_id,corriere_id,corrieri(nome_contratto,tipo),richiedi_ritiro,data_ritiro,intervallo_ritiro,ritiro_id,cod_ritiro:raw_response->>_codiceRitiro,ritiro_ponte:raw_response->>_ritiroPrenotato')
    .eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // IL RITIRO SI RILEGGE QUI. Sui contratti "V" il codice del corriere arriva quasi sempre dopo la
  // risposta di creazione, e prima nessuna chiamata lo restituiva: chi integra restava con
  // codice:null per sempre. Qui compare solo un ritiro che esiste; senza, `ritiro` e' null.
  const tipo = (s.corrieri as any)?.tipo || null
  let ritiro: any = null
  if (s.ritiro_id) {
    // Prenotato dopo, da /api/v1/pickups o dalla sezione Ritiri del portale.
    const { data: r } = await admin.from('ritiri').select('cod_ritiro,data_ritiro,cliente_id').eq('id', s.ritiro_id).maybeSingle()
    if (r && r.cliente_id === ctx.clienteId) {
      ritiro = ritiroInRisposta({ prenotato: true, data: r.data_ritiro, intervallo: s.intervallo_ritiro, codice: r.cod_ritiro, tipo, spedizioneId: s.id })
    }
  }
  // Chiesto alla creazione: vale solo dove la creazione lo prenota davvero. Prima del 21/10/2026
  // richiedi_ritiro restava acceso anche sugli altri contratti, dove non partiva niente; e i ritiri
  // fatti allora con /api/v1/pickups non erano legati alla spedizione. Su quelle vecchie righe non
  // si sa: meglio null che un "prenotato" o un "non prenotato" non veri.
  const prenotatoAllaCreazione = tipo === 'easyparcel' || (tipo === 'moovexpress' && (s as any).ritiro_ponte === 'true')
  if (!ritiro && s.richiedi_ritiro && prenotatoAllaCreazione) {
    ritiro = ritiroInRisposta({ prenotato: true, data: s.data_ritiro, intervallo: s.intervallo_ritiro, codice: codiceRitiroValido((s as any).cod_ritiro), tipo, spedizioneId: s.id })
  }
  // Registro degli accessi ai dati personali anche per l'API (il dettaglio porta il destinatario).
  after(() => registraAudit({ ruolo: 'api', azione: 'api_spedizione', risorsa: s.numero, dettaglio: `cliente ${ctx.clienteId}` }))
  return NextResponse.json({
    id: s.id, tracking: s.tracking_number || s.numero, stato: s.stato,
    contratto: (s.corrieri as any)?.nome_contratto || null, prezzo: Number(s.costo_totale || 0), valuta: 'EUR',
    destinatario: { nome: s.dest_nome, citta: s.dest_citta, provincia: s.dest_provincia, cap: s.dest_cap, paese: s.dest_paese },
    colli: s.colli, peso: s.peso_reale, contrassegno: Number(s.contrassegno || 0),
    notes: s.note || null,
    label_url: `/api/v1/shipments/${s.id}/label`, created_at: s.created_at,
    ritiro,
  })
}

// Annulla una spedizione creata via API — SOLO se ancora "in_lavorazione".
// Come la UI: va in ATTESA 48h (annullamento_pending); l'annullo al corriere + storno
// avvengono dopo, via cron. Niente annullata immediata. Eccezione, come nella UI: i contratti DVA
// chiedono lo storno SUBITO e restano in 'storno_richiesto' finche' il corriere non conferma.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,numero,dest_nome,dest_provincia,dest_cap,dest_paese,costo_totale,costo_spedizione,corriere_id,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,stato')
    .eq('id', id).maybeSingle()
  if (!sped || sped.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // Stessa guardia del portale: se il master ha acceso "vieta cancellazione" su questo cliente, la
  // chiave API non e' una scorciatoia per aggirarlo (la chiave agisce PER CONTO del cliente).
  const { clienteNonPuoCancellare, MSG_CANCELLAZIONE_VIETATA } = await import('@/lib/cancellazione-cliente')
  if (await clienteNonPuoCancellare(admin, sped.cliente_id))
    return NextResponse.json({ error: MSG_CANCELLAZIONE_VIETATA }, { status: 403 })
  if (sped.stato === 'annullata') return NextResponse.json({ success: true, already: true })
  if (sped.stato === 'annullamento_pending') return NextResponse.json({ success: true, pending: true })
  if (sped.stato === 'storno_richiesto') return NextResponse.json({ success: true, stato: 'storno_richiesto', message: 'Annullamento già richiesto al corriere: è in verifica.' })
  if (sped.stato === 'annullamento_manuale') return NextResponse.json({ success: true, stato: 'annullamento_manuale', message: 'Annullamento già in gestione.' })

  // REGOLA API: annullabile solo finché è in lavorazione (non ancora data al corriere).
  if (sped.stato !== 'in_lavorazione') {
    return NextResponse.json({ error: 'Spedizione già affidata al corriere: non annullabile via API' }, { status: 409 })
  }

  // CONTRATTI DVA: stesso ramo di spedizioni/elimina. Prima anche dall'API si aspettavano le 48 ore e
  // solo dopo il cron chiedeva lo storno: altre 48 ore di etichetta valida, senza motivo, prima che
  // la richiesta arrivasse a chi la deve lavorare. Il rimborso resta alla conferma del corriere.
  const { data: corr } = await admin.from('corrieri').select('tipo,nome_contratto,master_id').eq('id', sped.corriere_id).maybeSingle()
  if (corr?.tipo === 'easyparcel') {
    const { richiediStornoDva } = await import('@/lib/storno-dva')
    const { data: rr } = await admin.from('spedizioni').select('raw_response').eq('id', id).maybeSingle()
    let r
    try { r = await richiediStornoDva(admin, { ...sped, raw_response: rr?.raw_response } as any, null) }
    catch (e: any) { r = { azione: 'manuale' as const, codice: 'errore', messaggio: e?.message || 'errore storno' } }
    if (r.azione === 'gia_cancellato') {
      after(async () => { try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, [id]) } catch (e: any) { console.error('[SHOPIFY][ANNULLO da api v1]', id, e?.message) } })
      return NextResponse.json({ success: true, stato: 'annullata', message: 'Spedizione annullata e credito stornato.' })
    }
    if (r.azione === 'richiesto') {
      return NextResponse.json({ success: true, stato: 'storno_richiesto', message: 'Annullamento richiesto al corriere: è in verifica. Il credito viene stornato appena il corriere conferma la cancellazione.' })
    }
    // Non stornabile / errore / transitorio -> coda del DETENTORE col motivo, come dal portale.
    const ownerId = await trovaOwnerContratto(admin, corr.master_id, corr.nome_contratto)
    const { error: manErr } = await admin.from('spedizioni').update({
      stato: 'annullamento_manuale', stato_precedente: sped.stato, annullamento_owner_id: ownerId,
      annullamento_richiesto_at: new Date().toISOString(), annullamento_da: null, annullamento_errore: r.messaggio || null,
    }).eq('id', id)
    if (manErr) return NextResponse.json({ error: manErr.message }, { status: 400 })
    return NextResponse.json({ success: true, stato: 'annullamento_manuale', message: 'Annullamento richiesto: verrà completato dall\'assistenza e il credito stornato alla conferma.' })
  }

  // STESSA regola della UI: la cancellazione va in ATTESA 48h (annullamento_pending), poi il cron
  // invia l'annullo al corriere e fa lo storno. Niente annullata immediata (no bypass del pending).
  const { error: updErr } = await admin.from('spedizioni').update({
    stato: 'annullamento_pending',
    stato_precedente: sped.stato,
    annullamento_richiesto_at: new Date().toISOString(),
    annullamento_da: null,
    annullamento_errore: null,
  }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  return NextResponse.json({ success: true, stato: 'annullamento_pending', message: 'Annullamento programmato: verrà inviato al corriere tra 48 ore.' })
}
