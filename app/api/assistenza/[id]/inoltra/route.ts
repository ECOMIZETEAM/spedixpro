import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// INOLTRA il ticket a CHI FORNISCE IL CONTRATTO a chi lo gestisce (vedi destinazioneInoltro): il
// ticket resta UNICO, chi lo riceve entra nella catena (rete_master_ids) e vede tutta la
// conversazione; i suoi messaggi sono SEMPRE interni (visibilita 'rete') e il cliente non saprà mai
// dell'inoltro.
// Possono inoltrare: l'owner (assistenza diretta) e i master già in catena (escalation a salire).
//
// POD INOLTRATA: CHI INOLTRA PAGA. Dal 04/11/2026 il master che inoltra al suo superiore una POD
// (di un suo cliente, o arrivata a lui dal basso) la paga al superiore, quanto dice il listino POD
// del superiore per i master sotto di lui — come se l'avesse aperta lui dal pulsante della
// spedizione. Vede il prezzo prima (GET qui sotto), accetta, e l'addebito parte prima dell'inoltro,
// una volta sola per ogni master che inoltra (scripts/pod-prezzi-master.sql, addebita_pod_inoltro).
// Decisione del committente: l'inoltro era la strada piu' battuta (Velox 71, spedizioni 2000 62,
// GTS 40 POD inoltrate a MULTIEXPRESS) e restava gratis.
// OGNI SALTO PAGA SUL SUO CONTO (17/11/2026). Dal superiore: listino POD del superiore per i master
// sotto, sul conto verso di lui. Da chi vende il contratto FUORI dall'albero: il compratore per lui
// e' un cliente, il suo "(ingrosso)" — listino POD CLIENTI del venditore, su quel conto (decisione
// del committente, 17/11/2026: spedizioni 2000 → GTS EXPRESS 3,30 €, Wave ship → LOGIXIA su SDA
// EXPRESS L 2,55 €). Nel listino clienti le regole per contratto sono sulle righe del VENDITORE,
// quindi il prezzo si cerca sulla sua riga della fila, non su quella della spedizione.
async function prezzoInoltroPod(admin: any, t: any, mio: string, dest: Inoltro): Promise<number> {
  const { risolviPrezzoPod } = await import('@/lib/pod-prezzo')
  if (dest.conto === 'ingrosso') {
    return risolviPrezzoPod(admin, { masterId: dest.id, clienteId: dest.ingrossoId, corriereId: dest.corriereVenditore })
  }
  if (dest.conto !== 'superiore') return 0
  let corriereId: string | null = null
  if (t.spedizione_id) {
    const { data: sp } = await admin.from('spedizioni').select('corriere_id').eq('id', t.spedizione_id).maybeSingle()
    corriereId = sp?.corriere_id || null
  }
  return risolviPrezzoPod(admin, { masterId: dest.id, sottoMasterId: mio, corriereId })
}

// ── A CHI SALE: A CHI TI HA VENDUTO IL CONTRATTO, NON AL MASTER SOPRA DI TE. ─────────────────────
// Il contratto di una spedizione ha la sua fila: chi lo vende a chi, fino al detentore
// (corrieri.fornitore_corriere_id, letta da catena_contratto). L'albero dei master dice chi gestisce
// chi, non chi vende cosa: "MULTI→GTS→2000, senza stare a pensare che sono fratelli" (decisione del
// committente, 14/10/2026). Prima il ticket saliva SEMPRE al master superiore e il contratto si
// riconosceva per NOME, e su chi compra da un master che non e' il suo superiore si rompeva:
//  - BLOCCATO: Velox su SDA EXPRESS, che compra da SPEDIZIONI EXPRESS (TK-10229, TK-10505, TK-10507),
//    e MULTIEXPRESS su SDA EXPRESS L, che compra da Wave ship (TK-09353, TK-09592, TK-09744): "il
//    master superiore non ha il contratto... giralo a chi te lo fornisce", ma non c'era modo di farlo;
//  - AL MASTER SBAGLIATO, se il superiore aveva un contratto con lo stesso nome: le 11 richieste di
//    spedizioni 2000 su GLS CASERTA Consegna Diretta, che compra da GTS EXPRESS, sono finite a
//    MULTIEXPRESS (novembre 2026); quelle di Atlantik su UPS Europa e GLS Light Napoli, che compra da
//    SEMPLICE SPEDIRE, a Giga Express.
// La fila dice anche dove FERMARSI: chi detiene il contratto e' l'ultimo che puo' farci qualcosa, e
// il ticket non sale oltre (prima lo si deduceva dal nome, ora dall'identita' della riga). Solo un
// ticket da cui non si risale a nessun pacco va ancora al master superiore: non c'e' un contratto da
// seguire.
// conto: su quale conto si paga una POD inoltrata (vedi prezzoInoltroPod). 'superiore' = verso il
// master superiore, che e' anche chi vende; 'ingrosso' = il cliente "(ingrosso)" presso un venditore
// fuori dall'albero; null = nessun conto per quel salto (non si addebita).
type Inoltro = {
  id: string; nome: string | null
  conto: 'superiore' | 'ingrosso' | null; ingrossoId: string | null; corriereVenditore: string | null
}
type Destinazione = Inoltro | { errore: string }
async function destinazioneInoltro(admin: any, t: any, mio: string, padreId: string | null): Promise<Destinazione> {
  // I contratti del ticket: quello della spedizione collegata o, per i ticket aperti dal modulo
  // libero (in produzione parlano eccome di pacchi), quelli dei numeri scritti nel testo.
  // Il client di servizio scavalca le regole per riga: la ricerca va RICHIUSA a mano nel
  // perimetro del ticket (suo cliente, o suo master), altrimenti un codice scritto a caso
  // aggancerebbe la spedizione di un altro e manderebbe il ticket al suo fornitore.
  const corrieri = new Set<string>()
  if (t.spedizione_id) {
    const { data: sp } = await admin.from('spedizioni').select('corriere_id').eq('id', t.spedizione_id).maybeSingle()
    if (sp?.corriere_id) corrieri.add(sp.corriere_id)
  } else {
    const testo = `${t.oggetto || ''} ${t.messaggio || ''}`.toUpperCase()
    const codici = Array.from(new Set(testo.split(/[^A-Z0-9]+/).filter(x => x.length >= 6))).slice(0, 15)
    if (codici.length) {
      let q = admin.from('spedizioni').select('corriere_id')
        .or(`numero.in.(${codici.join(',')}),tracking_number.in.(${codici.join(',')})`)
      q = t.cliente_id ? q.eq('cliente_id', t.cliente_id) : q.eq('master_id', t.owner_master_id)
      const { data: sps } = await q.limit(25)
      for (const s of (sps || []) as any[]) if (s?.corriere_id) corrieri.add(s.corriere_id)
    }
  }

  let destId: string | null = null
  let salto: any = null                    // la riga di chi inoltra nella fila, e quella sopra
  let su: any = null
  if (!corrieri.size) {
    if (!padreId) return { errore: 'Sei al vertice della rete: non c\'è un master superiore a cui inoltrare.' }
    destId = padreId
  } else {
    const venditori = new Set<string>()
    for (const cid of corrieri) {
      const [{ data: fila, error }, { data: c }] = await Promise.all([
        admin.rpc('catena_contratto', { p_corriere_id: cid }),
        admin.from('corrieri').select('nome_contratto').eq('id', cid).maybeSingle(),
      ])
      // Una fila che non si legge NON vuol dire "vai al superiore": e' proprio l'errore da togliere.
      if (error) throw new Error('Fila del contratto non leggibile: ' + error.message)
      const nome = c?.nome_contratto || 'di questa spedizione'
      const righe: any[] = fila || []
      const i = righe.findIndex((r: any) => r.master_id === mio)
      if (i < 0) {
        return { errore: `Il contratto di questa spedizione (${nome}) non passa da te: non hai nessuno a cui inoltrare il ticket.` }
      }
      if (righe[i].salto === 'detentore') {
        return { errore: `Questo ticket riguarda un tuo contratto (${nome}): l'assistenza si ferma a te, che lo detieni. Sopra di te nessuno ha quel rapporto col fornitore — vedila col tuo fornitore diretto.` }
      }
      // 'interrotta' = la riga di chi lo vendeva non c'e' piu': si tratta come sospeso, mai come proprio.
      const sopra = righe[i + 1]
      if (righe[i].salto === 'interrotta' || !sopra?.master_id) {
        return { errore: `Non si riesce a risalire a chi ti fornisce il contratto ${nome}: il ticket non può salire. Segnalalo all'assistenza MoovExpress.` }
      }
      venditori.add(sopra.master_id)
      if (!salto) { salto = righe[i]; su = sopra }
    }
    if (venditori.size > 1) {
      return { errore: 'Il ticket parla di pacchi su contratti forniti da master diversi: aprilo dalla singola spedizione per inoltrarlo.' }
    }
    destId = Array.from(venditori)[0]
  }
  const { data: dest } = await admin.from('masters').select('nome').eq('id', destId).maybeSingle()
  // Il venditore e' il superiore quando il contratto scende per l'albero (o non c'e' un contratto);
  // fuori dall'albero il salto e' un collegamento, col suo conto "(ingrosso)" presso il venditore.
  // Un salto d'albero che salta il superiore non ha un conto suo: non si addebita.
  const conto: Inoltro['conto'] = salto?.salto === 'collegamento'
    ? (salto.ledger_cliente_id ? 'ingrosso' : null)
    : (destId === padreId ? 'superiore' : null)
  return {
    id: destId!, nome: dest?.nome || null, conto,
    ingrossoId: conto === 'ingrosso' ? salto.ledger_cliente_id : null,
    corriereVenditore: su?.corriere_id || null,
  }
}

// GET: quanto costa a me inoltrare questa POD (la pagina lo mostra prima del si').
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const mio = utente?.master_id
  const ruolo = (utente?.ruolo || '').toLowerCase()
  if (!mio || ruolo === 'cliente' || utente?.cliente_id || ruolo === 'agente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets').select('id,categoria,owner_master_id,rete_master_ids,spedizione_id,cliente_id,oggetto,messaggio,pod_inoltri').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  const rete: string[] = Array.isArray(t.rete_master_ids) ? t.rete_master_ids : []
  if (mio !== t.owner_master_id && !rete.includes(mio)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (t.categoria !== 'pod') return NextResponse.json({ pod: false })
  if ((t.pod_inoltri as any)?.[mio]) return NextResponse.json({ pod: true, prezzo: 0, gia_pagata: true })
  const { data: me } = await admin.from('masters').select('parent_master_id').eq('id', mio).maybeSingle()
  try {
    const dest = await destinazioneInoltro(admin, t, mio, me?.parent_master_id || null)
    // Se l'inoltro non si puo' fare, il motivo lo dice la POST: qui niente cifra da accettare.
    if ('errore' in dest) return NextResponse.json({ pod: true, prezzo: 0 })
    return NextResponse.json({ pod: true, prezzo: await prezzoInoltroPod(admin, t, mio, dest), padre: dest.nome })
  } catch {
    return NextResponse.json({ error: 'Non riesco a calcolare il costo dell\'inoltro: riprova tra poco.' }, { status: 503 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const mio = utente?.master_id
  const ruolo = (utente?.ruolo || '').toLowerCase()
  // Inoltrare espone la conversazione del cliente a un altro master ed e' IRREVERSIBILE:
  // fuori il portale cliente e l'agente (sola lettura, niente rete - lib/agente.ts).
  if (!mio || ruolo === 'cliente' || utente?.cliente_id || ruolo === 'agente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets')
    // oggetto/messaggio/cliente_id servono a destinazioneInoltro: i ticket aperti dal modulo libero
    // non hanno spedizione_id e portano il numero del pacco scritto nel testo.
    .select('id,stato,categoria,owner_master_id,aperto_master_id,rete_master_ids,rete_non_letti,spedizione_id,cliente_id,oggetto,messaggio,pod_inoltri')
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  if (t.stato === 'chiuso') return NextResponse.json({ error: 'Ticket chiuso: non inoltrabile.' }, { status: 400 })

  const rete: string[] = Array.isArray(t.rete_master_ids) ? t.rete_master_ids : []
  const inCatena = mio === t.owner_master_id || rete.includes(mio)
  if (!inCatena) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // A chi sale: a chi fornisce il contratto a CHI INOLTRA (un gradino alla volta) — vedi in cima.
  const { data: me } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', mio).maybeSingle()
  let dest: Destinazione
  try { dest = await destinazioneInoltro(admin, t, mio, me?.parent_master_id || null) } catch {
    return NextResponse.json({ error: 'Non riesco a risalire a chi ti fornisce il contratto: riprova tra poco.' }, { status: 503 })
  }
  if ('errore' in dest) return NextResponse.json({ error: dest.errore }, { status: 400 })
  if (dest.id === t.aperto_master_id) {
    return NextResponse.json({ error: 'Questo ticket te l\'ha aperto proprio chi ti fornisce il contratto: rispondigli qui.' }, { status: 400 })
  }
  if (dest.id === t.owner_master_id || rete.includes(dest.id)) {
    return NextResponse.json({ error: 'Il ticket è già stato inoltrato a quel master.' }, { status: 400 })
  }

  // POD: chi inoltra paga, PRIMA che la richiesta salga (vedi in cima). Se l'addebito
  // non riesce l'inoltro non parte: la richiesta resta dov'e' e si riprova. Una seconda volta (doppio
  // clic, risposta persa) non paga di nuovo: lo impedisce la funzione del database.
  let podAddebitato = 0
  if (t.categoria === 'pod') {
    // A pagare e' il master: inoltra la POD solo chi lo governa, non l'autista.
    const { vedeLaRete } = await import('@/lib/perimetro')
    if (!vedeLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato a inoltrare la POD per il master' }, { status: 403 })
  }
  if (t.categoria === 'pod' && !(t.pod_inoltri as any)?.[mio]) {
    const body = await req.json().catch(() => ({}))
    let prezzo = 0
    try { prezzo = await prezzoInoltroPod(admin, t, mio, dest) } catch {
      return NextResponse.json({ error: 'Non riesco a calcolare il costo dell\'inoltro: riprova tra poco.' }, { status: 503 })
    }
    if (prezzo > 0) {
      const cifra = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(prezzo)
      if (body?.accetto_addebito !== true) {
        return NextResponse.json({ error: `Inoltrando questa POD a ${dest.nome || 'il tuo master superiore'} ti vengono addebitati ${cifra}: conferma per inoltrarla.`, pod_prezzo: prezzo }, { status: 409 })
      }
      if (!(Math.abs(Number(body?.prezzo_accettato) - prezzo) < 0.005)) {
        return NextResponse.json({ error: `Il costo dell'inoltro è cambiato: ora è ${cifra}. Controlla e conferma di nuovo.`, pod_prezzo: prezzo }, { status: 409 })
      }
    }
    // Fuori dall'albero si paga sul conto "(ingrosso)" presso il venditore: funzione a parte
    // (scripts/pod-prezzi-master.sql), stessa presa una volta sola per master.
    const { data: addebitato, error: errAdd } = dest.conto === 'ingrosso'
      ? await admin.rpc('addebita_pod_inoltro_ingrosso', {
          p_ticket_id: id, p_master_id: mio, p_venditore_id: dest.id, p_ingrosso_id: dest.ingrossoId,
          p_prezzo: prezzo, p_created_by: user.id,
        })
      : await admin.rpc('addebita_pod_inoltro', {
          p_ticket_id: id, p_master_id: mio, p_padre_id: dest.id, p_prezzo: prezzo, p_created_by: user.id,
        })
    if (errAdd) {
      console.error('[POD][INOLTRO] addebito non riuscito, inoltro fermato — ticket', id, errAdd.message)
      return NextResponse.json({ error: 'Addebito della POD non riuscito: l\'inoltro non è partito, riprova.' }, { status: 500 })
    }
    podAddebitato = Number(addebitato) || 0
  }

  await admin.from('tickets').update({
    inoltrato_a_master_id: dest.id,
    rete_master_ids: [...rete, dest.id],
    rete_non_letti: Array.from(new Set([...(t.rete_non_letti || []).filter((x: string) => x !== mio), dest.id])),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Traccia dell'inoltro nella chat: INTERNA, il cliente non la vede. L'autore e' chi la RICEVE
  // (dest), non chi inoltra: la traccia rivela il livello superiore, quindi deve stare "in alto"
  // nella catena. Cosi' chi sta SOTTO il forwarder non la vede (regola messaggioVisibileCatena:
  // autore alla posizione p+2 non e' visibile a chi sta a p). Chi inoltra la vede lo stesso (p+1).
  await admin.from('ticket_messaggi').insert({
    ticket_id: id, autore: 'rete', autore_nome: 'Sistema', visibilita: 'rete', autore_master_id: dest.id,
    testo: `📤 Ticket inoltrato da ${me?.nome || 'master'} a ${dest.nome || 'master superiore'}.`,
  })

  return NextResponse.json({ success: true, inoltrato_a: dest.nome, pod_addebitato: podAddebitato })
}
