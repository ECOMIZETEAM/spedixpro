import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente, bloccaAgente } from '@/lib/agente'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { eseguiSvincolo } from '@/lib/giacenza-svincolo'
// Il calcolo dei prezzi giacenza vive in lib/giacenza-prezzi.ts: lo usa anche l'API pubblica,
// che prima registrava le richieste con costo zero.
import { chiaveServizio, prezziVuoti, leggiPrezzi, leggiPrezziDaListino, calcolaCosti, noloClienteSpedizione } from '@/lib/giacenza-prezzi'
import { noloCliente, noloMaster } from '@/lib/reso-prezzi'

// Gestione di una singola giacenza (dettaglio "Gestisci").
// Flusso a due attori: il cliente sceglie l'operazione (riconsegna / riconsegna a
// nuovo destinatario / reso) e chiede lo svincolo; il master vede la richiesta,
// puo' aggiungere costi manuali e conferma lo svincolo -> addebito + invio al corriere.

type Ctx = { admin: any; sped: any; ruolo: 'cliente' | 'master'; agente?: boolean; masterId?: string; clienteId?: string; listinoAgenteId?: string | null; nomeUtente: string }





// Prezzi giacenza dal LISTINO CORRIERE del master (quello che paga il master).
async function leggiPrezziMaster(admin: any, corriereId: string | null) {
  const out = prezziVuoti()
  if (!corriereId) return out
  // STESSA REGOLA di lib/giacenza-cascata (ordine per id, vince il PRIMO): con supplementi
  // duplicati — capita quando un master ha piu' listini corrieri per lo stesso contratto — qui si
  // leggeva senza ordine e vinceva l'ULTIMO, quindi il prezzo MOSTRATO poteva non essere quello
  // realmente ADDEBITATO (es. apertura 0,60 a schermo e 0,61 sul movimento).
  // Come lib/giacenza-cascata: SOLO i listini del master proprietario del contratto, cosi' il
  // prezzo mostrato e' esattamente quello impostato nel suo Listino Corrieri (niente righe
  // "fantasma" appartenenti al listino di un altro master).
  const { data: corrOwner } = await admin.from('corrieri').select('master_id').eq('id', corriereId).maybeSingle()
  const { data: listiniOwner } = await admin.from('listini_corrieri').select('id').eq('master_id', (corrOwner as any)?.master_id || '')
  const idsOwner = (listiniOwner || []).map((l: any) => l.id)
  if (!idsOwner.length) return out
  const { data: suppl } = await admin.from('listini_corrieri_supplementi')
    .select('tipo,nome,valore,descrizione').eq('corriere_id', corriereId).in('listino_id', idsOwner).in('tipo', ['giacenza', 'giacenza_apertura'])
    .order('id', { ascending: true })
  let aperturaSet = false
  const servizioSet: Record<string, boolean> = {}
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aperturaSet) { out.apertura = Number(s.valore) || 0; aperturaSet = true } continue }
    const k = chiaveServizio(s.nome)
    if (!k || servizioSet[k]) continue
    let perc = 0
    try { perc = Number(JSON.parse(s.descrizione || '{}')?.perc) || 0 } catch { /* descrizione non JSON */ }
    out.servizi[k] = { valore: Number(s.valore) || 0, perc }
    servizioSet[k] = true
  }
  return out
}



async function contesto(req: NextRequest, id: string): Promise<Ctx | NextResponse> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome,listino_agente_id').eq('id', user.id).single()
  const ruolo = (utente?.ruolo || '').toLowerCase() === 'cliente' ? 'cliente' : 'master'
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(tipo,credenziali,nome_contratto,master_id)')
    .eq('id', id).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Giacenza non trovata' }, { status: 404 })
  if (ruolo === 'cliente') {
    if (sped.cliente_id !== utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  } else {
    // Il master gestisce le giacenze di TUTTA la sua rete (sotto-albero), non solo le proprie:
    // prima con `sped.master_id !== mio` dava "Non autorizzato" sulle giacenze dei sotto-master.
    const subtree = utente?.master_id ? await sottoAlberoMasterIds(admin, utente.master_id) : []
    if (!sped.master_id || !subtree.includes(sped.master_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  // Agente: solo giacenze di un suo cliente.
  if (isAgente(utente)) {
    const miei = await clientiAgente(supabase, utente)
    if (!sped.cliente_id || !miei.includes(sped.cliente_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  return { admin, sped, ruolo, agente: isAgente(utente), masterId: utente?.master_id, clienteId: utente?.cliente_id, listinoAgenteId: (utente as any)?.listino_agente_id || null, nomeUtente: utente?.nome || (ruolo === 'cliente' ? 'Cliente' : 'Master') }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contesto(req, id)
  if (ctx instanceof NextResponse) return ctx
  const { admin, sped, ruolo, agente, listinoAgenteId, masterId } = ctx
  // "SOPRA IL CONTRATTO": se il master che guarda è ANTENATO del proprietario del contratto, è un
  // semplice passaggio → non vende nulla su questa spedizione → prezzo cliente E prezzo master = 0
  // (margine 0), come nell'Elenco/Report. Il prezzo del cliente finale lo vede solo il proprietario
  // (o un suo rivenditore a valle), non i master sopra. Evita che, es., Ecomize Solution veda il
  // €5 del cliente di Ecomize LL quando il contratto è di Ecomize LL.
  const ownerId = (sped as any).corrieri?.master_id || null
  let sopraContratto = false
  if (ruolo === 'master' && masterId && ownerId && ownerId !== masterId) {
    let cur: string | null = ownerId
    for (let i = 0; i < 20 && cur; i++) {
      const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      cur = mm?.parent_master_id || null
      if (cur === masterId) { sopraContratto = true; break }
    }
  }

  const prezzi = sopraContratto ? prezziVuoti() : await leggiPrezzi(admin, sped)
  // Prezzo CONTROPARTE = quello che paga chi guarda (solo master/agente, mai il cliente):
  //  - master  → il suo costo dal listino corriere;
  //  - agente  → il suo costo dal listino agente assegnato.
  let prezziControparte: any = null
  let etichettaControparte: string | null = null
  if (ruolo === 'master') {
    if (sopraContratto) { prezziControparte = prezziVuoti(); etichettaControparte = 'master' }
    else if (agente) { prezziControparte = await leggiPrezziDaListino(admin, listinoAgenteId, sped.corriere_id); etichettaControparte = 'agente' }
    else { prezziControparte = await leggiPrezziMaster(admin, sped.corriere_id); etichettaControparte = 'master' }
  }
  const [{ data: storico }, { data: costi }] = await Promise.all([
    admin.from('giacenza_richieste').select('*').eq('spedizione_id', id).order('created_at', { ascending: false }),
    admin.from('giacenza_costi').select('*').eq('spedizione_id', id).order('created_at', { ascending: true }),
  ])
  // Le basi mostrate a video devono essere le STESSE su cui si addebita, e sono DUE: il cliente
  // paga la sua percentuale sul suo nolo, il master sulla propria. Con una base sola il costo
  // della controparte — e quindi il margine — usciva sbagliato a schermo.
  const base = await noloClienteSpedizione(admin, sped)
  let baseControparte: number | null = null
  if (ruolo === 'master' && !sopraContratto) {
    baseControparte = agente
      ? await noloCliente(admin, sped, listinoAgenteId)
      : (ownerId ? await noloMaster(admin, ownerId, sped.corriere_id, sped) : null)
  } else if (sopraContratto) {
    baseControparte = 0
  }
  // LE CREDENZIALI DEL CORRIERE NON ESCONO DA QUI.
  // La spedizione veniva restituita intera, e dentro ci sono le credenziali del contratto —
  // authcode, password, chiavi. Questa stessa pagina la apre anche il CLIENTE FINALE dal suo
  // portale: bastava guardare la risposta negli strumenti del browser per portarsi via la chiave
  // con cui spediamo. Servono solo qui dentro, per parlare col corriere: al browser si manda il
  // nome del contratto e basta.
  const { credenziali: _chiavi, ...corriereSenzaChiavi } = (sped.corrieri || {}) as any
  const spedPulita = { ...sped, corrieri: corriereSenzaChiavi }

  // NOMI DELLA RETE A MONTE NON ESCONO VERSO IL CLIENTE (nè l'agente).
  // Lo "Storico Azioni" mostra chi ha creato/confermato l'azione: quando la giacenza viene
  // lavorata da un master SOPRA (es. la root E&A MULTIEXPRESS conferma lo svincolo di un cliente
  // di Velox), il suo nome finiva nella colonna "Utente" del portale cliente. Il cliente non deve
  // MAI vedere la rete sopra il proprio master diretto: le sue azioni restano com'erano
  // (richiesta_da='cliente'), tutto ciò che è lato-rete si mostra col nome del SUO master diretto.
  // Sanitizzato qui, nella risposta, così il nome grezzo non raggiunge nemmeno il JSON del browser.
  let storicoOut: any[] = storico || []
  let costiOut: any[] = costi || []
  if (ruolo === 'cliente' || agente) {
    let nomeMasterDiretto = 'Master'
    const idMasterDiretto = masterId || (sped as any).master_id
    if (idMasterDiretto) {
      const { data: mst } = await admin.from('masters').select('nome').eq('id', idMasterDiretto).maybeSingle()
      nomeMasterDiretto = (mst as any)?.nome || 'Master'
    }
    storicoOut = storicoOut.map((r: any) => ({
      ...r,
      creata_da: r.richiesta_da === 'cliente' ? r.creata_da : nomeMasterDiretto,
      confermata_da: r.confermata_da ? nomeMasterDiretto : r.confermata_da,
    }))
    costiOut = costiOut.map((c: any) => ({ ...c, creato_da: c.creato_da ? nomeMasterDiretto : c.creato_da }))
  }

  return NextResponse.json({
    sped: spedPulita, prezzi, prezziControparte, etichettaControparte,
    noloBase: base, noloBaseControparte: baseControparte,
    storico: storicoOut, costi: costiOut, ruolo,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contesto(req, id)
  if (ctx instanceof NextResponse) return ctx
  if ((ctx as any).agente) return NextResponse.json({ error: 'Operazione non consentita: gli agenti hanno accesso in sola lettura.' }, { status: 403 })
  const { admin, sped, ruolo, masterId, nomeUtente } = ctx
  const body = await req.json()
  const azione = body?.azione

  // 1) Richiesta operazione (cliente o master)
  if (azione === 'richiesta') {
    const operazione = String(body?.operazione || '')
    if (!['riconsegna', 'riconsegna_nuovo', 'reso'].includes(operazione)) return NextResponse.json({ error: 'Operazione non valida' }, { status: 400 })
    const prezzi = await leggiPrezzi(admin, sped)
    const costi = calcolaCosti(operazione, prezzi, sped, await noloClienteSpedizione(admin, sped))
    const { data, error } = await admin.from('giacenza_richieste').insert({
      spedizione_id: id, master_id: sped.master_id, cliente_id: sped.cliente_id,
      operazione, data_operazione: body?.data || null, note: body?.note || null,
      nuovo_destinatario: operazione === 'riconsegna_nuovo' ? (body?.nuovoDestinatario || null) : null,
      ...costi, richiesta_da: ruolo, creata_da: nomeUtente, stato: 'da_confermare',
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    // La spedizione resta in giacenza ma segnata "in attesa di conferma svincolo"
    await admin.from('spedizioni').update({ giacenza_stato: 'in_gestione' }).eq('id', id)
    return NextResponse.json({ success: true, id: data?.id, costi })
  }

  // 2) Aggiunta costo manuale (solo master)
  if (azione === 'aggiungi_costo') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    const importo = Number(body?.importo) || 0
    const { error } = await admin.from('giacenza_costi').insert({ spedizione_id: id, master_id: masterId, nota: body?.nota || null, importo, creato_da: nomeUtente })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }
  if (azione === 'rimuovi_costo') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    await admin.from('giacenza_costi').delete().eq('id', body?.costoId).eq('spedizione_id', id)
    return NextResponse.json({ success: true })
  }

  // 3) Annulla una richiesta ancora da confermare
  if (azione === 'annulla') {
    await admin.from('giacenza_richieste').update({ stato: 'annullata' }).eq('id', body?.richiestaId).eq('spedizione_id', id).eq('stato', 'da_confermare')
    return NextResponse.json({ success: true })
  }

  // 4) Conferma svincolo -> addebito + aggiornamento + invio al corriere.
  // Lo fanno CLIENTE e master: entrambi svincolano in autonomia (il cliente decide del SUO pacco).
  // Il contesto ha gia' autorizzato chi chiama (il cliente possiede la spedizione, il master la ha
  // in catena, l'agente e' gia' bloccato sopra in sola lettura). Il corriere viene chiamato con le
  // credenziali del CONTRATTO lato server: il cliente non vede mai il nome del provider. L'addebito
  // cade sempre su sped.cliente_id/master_id, non su chi preme il bottone; i costi manuali (extra)
  // li aggiunge solo il master, quindi per un cliente valgono 0.
  if (azione === 'conferma_svincolo') {
    const { data: rich } = await admin.from('giacenza_richieste').select('*').eq('id', body?.richiestaId).eq('spedizione_id', id).maybeSingle()
    if (!rich) return NextResponse.json({ error: 'Richiesta non trovata' }, { status: 404 })
    if (rich.stato === 'confermata') return NextResponse.json({ error: 'Richiesta gia confermata' }, { status: 400 })

    // Lo svincolo vero (corriere + addebito a cascata + distinta reso + marca 'svincolata') vive in
    // lib/giacenza-svincolo: PORTA UNICA usata anche dall'API v1, così la regola dei soldi sta in un
    // posto solo. Blocca (throw) se il corriere rifiuta → qui diventa 400, niente 'svincolata' finta.
    try {
      const { addebito, distintaReso, avviso } = await eseguiSvincolo(admin, sped, rich, nomeUtente)
      return NextResponse.json({ success: true, addebito, distintaReso, avviso })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Svincolo non riuscito' }, { status: 400 })
    }
  }

  // 5) Chiudi giacenza (solo master) -> non piu gestibile
  if (azione === 'chiudi') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Solo il master puo chiudere la giacenza' }, { status: 403 })
    await admin.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}
