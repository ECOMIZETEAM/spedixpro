import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'
import { addebitaPod } from '@/lib/pod-addebito'

// Apertura di un ticket di assistenza.
// - Cliente: il ticket va al proprio master (owner = master del cliente).
// - Sotto-master: il ticket va alla linea superiore (owner = parent del proprio master).
// - Master su una spedizione di un SUO cliente diretto: il ticket e' del cliente (vedi sotto).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if ((utente?.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const masterId = utente?.master_id
  if (!masterId) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const body = await req.json()
  const categoria = body?.categoria === 'pod' ? 'pod' : 'ticket'
  const oggetto = String(body?.oggetto || '').trim()
  // per la POD il messaggio è facoltativo (basta la LDV)
  const messaggio = String(body?.messaggio || '').trim() || (categoria === 'pod' ? 'Richiesta POD' : '')
  if (!oggetto || !messaggio) return NextResponse.json({ error: categoria === 'pod' ? 'Inserisci la LDV' : 'Oggetto e messaggio sono obbligatori' }, { status: 400 })

  const admin = createAdminSupabase()
  const ruolo = (utente?.ruolo || '').toLowerCase()

  const record: any = { oggetto, messaggio, stato: 'aperto', categoria, non_letto_owner: true }

  if (ruolo === 'cliente') {
    if (!utente?.cliente_id) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
    const { data: cli } = await admin.from('clienti')
      .select('ragione_sociale,ticket_bloccato,ticket_limite_giornaliero').eq('id', utente.cliente_id).maybeSingle()
    // FRENO impostato dal master su QUESTO cliente (alcuni abusano dei ticket). Vale SOLO sui ticket di
    // assistenza, non sulle richieste POD (prova di consegna = diritto del cliente, non si blocca).
    if (categoria === 'ticket') {
      if (cli?.ticket_bloccato) {
        return NextResponse.json({ error: 'L\'apertura di nuove richieste di assistenza è stata sospesa dal tuo referente. Contattalo direttamente.' }, { status: 403 })
      }
      const limite = Number(cli?.ticket_limite_giornaliero || 0)
      if (limite > 0) {
        const oggi = new Date(); oggi.setHours(0, 0, 0, 0)
        // Non contano i ticket che il master ha aperto PER il cliente: il limite frena il cliente, e
        // non deve consumarsi perche' la sua assistenza ha scritto al posto suo.
        const { count } = await admin.from('tickets').select('id', { count: 'exact', head: true })
          .eq('cliente_id', utente.cliente_id).eq('categoria', 'ticket').gte('created_at', oggi.toISOString())
          .neq('tipo_apertura', 'master_per_cliente')
        if ((count || 0) >= limite) {
          return NextResponse.json({ error: `Hai raggiunto il limite di ${limite} richieste al giorno concordato col tuo referente. Riprova domani.` }, { status: 429 })
        }
      }
    }
    record.owner_master_id = masterId
    record.cliente_id = utente.cliente_id
    record.aperto_da = cli?.ragione_sociale || 'Cliente'
    record.tipo_apertura = 'cliente'
  } else {
    // È un master: il ticket va alla sua linea superiore. Il "non hai una linea superiore" si
    // decide piu' sotto: sulla spedizione di un suo cliente il ticket resta a lui e il padre non serve.
    const { data: m } = await admin.from('masters').select('nome,parent_master_id').eq('id', masterId).maybeSingle()
    record.owner_master_id = m?.parent_master_id || null
    record.aperto_master_id = masterId
    record.aperto_da = m?.nome || 'Master'
    record.tipo_apertura = 'master'
  }

  // Collegamento alla SPEDIZIONE (per il badge "ticket aperto" sull'elenco). Facoltativo, e
  // VALIDATO: il cliente può collegare solo una sua spedizione; il master solo una della sua rete
  // (sua o dei sotto-master). Se non valido, si apre il ticket senza collegamento (la LDV resta
  // comunque nell'oggetto) invece di fallire.
  const autorizzatoSp = async (sp: any): Promise<boolean> => {
    if (!sp) return false
    if (ruolo === 'cliente') return sp.cliente_id === utente?.cliente_id
    if (sp.master_id === masterId) return true
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    return (await sottoAlberoMasterIds(admin, masterId)).includes(sp.master_id)
  }
  let spCorriereId: string | null = null   // corriere della spedizione collegata: serve per il prezzo POD
  let spStato: string | null = null        // stato della spedizione collegata: la POD solo se consegnata
  let spClienteId: string | null = null    // cliente della spedizione collegata: decide di chi e' il ticket del master
  const spedIdIn = String(body?.spedizione_id || '').trim()
  if (spedIdIn) {
    const { data: sp } = await admin.from('spedizioni').select('id,cliente_id,master_id,corriere_id,stato').eq('id', spedIdIn).maybeSingle()
    if (await autorizzatoSp(sp)) { record.spedizione_id = (sp as any).id; spCorriereId = (sp as any).corriere_id || null; spStato = (sp as any).stato || null; spClienteId = (sp as any).cliente_id || null }
  }
  // Fallback: nessun id esplicito ma l'oggetto è una LDV → collega solo se combacia UNA sola
  // spedizione autorizzata (evita ambiguità se due master hanno numeri simili).
  if (!record.spedizione_id) {
    const ldv = oggetto.trim()
    if (ldv.length >= 4 && ldv.length <= 40) {
      // case-insensitive: l'oggetto può essere minuscolo (es. 1uw07wf…), il numero è maiuscolo.
      const { data: sps } = await admin.from('spedizioni').select('id,cliente_id,master_id,corriere_id,stato').ilike('numero', ldv).limit(2)
      if (sps && sps.length === 1 && await autorizzatoSp(sps[0])) { record.spedizione_id = (sps[0] as any).id; spCorriereId = (sps[0] as any).corriere_id || null; spStato = (sps[0] as any).stato || null; spClienteId = (sps[0] as any).cliente_id || null }
    }
  }

  // ── TICKET DEL MASTER SULLA SPEDIZIONE DI UN SUO CLIENTE: E' DEL CLIENTE. ──────────────────────
  // Il cliente spesso chiede al master su WhatsApp ("il pacco e' fermo, novita'?") e il master apre
  // il ticket dalla spedizione. Prima nasceva come ticket del master verso la SUA linea superiore e
  // il cliente non ne sapeva niente: TK-06836, Ecomize LL sulla LDV 282343J004032 di Blood ("risulta
  // smarrita, possiamo aprire segnalazione per rimborso?"), Blood non vedeva ne' il ticket ne' il
  // bollino sulla spedizione — e come lui i clienti di 469 ticket cosi' da luglio a ottobre 2026.
  // Ora nasce COME SE L'AVESSE APERTO IL CLIENTE, con il master come sua assistenza: il cliente lo
  // vede e legge la conversazione col master; se serve, il master lo inoltra a mano alla sua linea
  // superiore e da li' valgono le regole dell'inoltro (i messaggi di sopra il cliente non li vede).
  // Non sale da solo: decisione del committente, 26/10/2026.
  // Solo i ticket: una POD aperta cosi' verrebbe addebitata al cliente (si paga all'apertura).
  // Solo il cliente DIRETTO: su quello di un sotto-master l'assistenza del cliente e' il sotto-master.
  let perCliente = false
  if (ruolo !== 'cliente' && categoria === 'ticket' && spClienteId) {
    const { data: cliSp } = await admin.from('clienti').select('master_id,ragione_sociale').eq('id', spClienteId).maybeSingle()
    if (cliSp && cliSp.master_id === masterId) {
      perCliente = true
      const persona = [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || 'Assistenza'
      record.owner_master_id = masterId
      record.cliente_id = spClienteId
      record.aperto_master_id = null          // altrimenti il master risulterebbe il richiedente (lib/ticket-accesso)
      record.aperto_da = cliSp.ragione_sociale || 'Cliente'
      record.tipo_apertura = 'master_per_cliente'
      record.non_letto_owner = false          // l'ha scritto lui: non e' un "Nuovo" da leggere
      record.aperto_letto = false             // il pallino va al cliente
      record.assegnazioni = { [masterId]: { id: user.id, nome: persona } }   // chi apre se ne occupa
    }
  }
  if (ruolo !== 'cliente' && !perCliente && !record.owner_master_id) {
    return NextResponse.json({ error: 'Sei il master principale: non hai una linea superiore a cui aprire un ticket.' }, { status: 400 })
  }

  // POD = PROVA DI CONSEGNA: si chiede solo su una spedizione riconosciuta e CONSEGNATA, chiunque la
  // apra (cliente, o master verso la sua linea superiore). Decisione del committente, 15/10/2026: prima
  // passava qualunque LDV, e l'assistenza chiudeva a mano richieste su pacchi in giacenza, in transito
  // o mai affidati (TK-04649, TK-05441, TK-05902, TK-06002).
  if (categoria === 'pod') {
    if (!record.spedizione_id) {
      return NextResponse.json({ error: 'Non troviamo questa LDV tra le tue spedizioni: controlla il numero.' }, { status: 400 })
    }
    if (spStato !== 'consegnata') {
      return NextResponse.json({ error: 'La POD (prova di consegna) si può chiedere solo per una spedizione consegnata: questa non risulta ancora consegnata.' }, { status: 400 })
    }
  }

  // PREZZO POD, PAGATO ALL'APERTURA: la POD di un cliente costa quanto dice il listino POD del suo
  // master (lib/pod-prezzo: dipende dal vettore della spedizione). Il cliente lo vede prima
  // (api/assistenza/pod-prezzo), lo ACCETTA aprendo la richiesta e lo paga subito, qui sotto dopo la
  // creazione (decisione del committente, 15/10/2026: prima si pagava alla consegna della POD, e una
  // POD mandata come allegato in chat arrivava gratis). La cifra accettata dev'essere quella di adesso:
  // se il listino e' cambiato fra l'anteprima e l'invio si rifiuta e si mostra la nuova, invece di
  // addebitare una cifra diversa da quella che il cliente ha visto.
  if (categoria === 'pod' && record.cliente_id) {
    const { risolviPrezzoPod } = await import('@/lib/pod-prezzo')
    record.pod_prezzo = await risolviPrezzoPod(admin, {
      masterId: record.owner_master_id,
      clienteId: record.cliente_id,
      corriereId: spCorriereId,
    })
    if (record.pod_prezzo > 0) {
      const cifra = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(record.pod_prezzo)
      if (body?.accetto_addebito !== true) {
        return NextResponse.json({ error: `Per aprire la richiesta devi accettare l'addebito di ${cifra}.`, pod_prezzo: record.pod_prezzo }, { status: 409 })
      }
      if (!(Math.abs(Number(body?.prezzo_accettato) - record.pod_prezzo) < 0.005)) {
        return NextResponse.json({ error: `Il costo della POD è cambiato: ora è ${cifra}. Controlla e conferma di nuovo.`, pod_prezzo: record.pod_prezzo }, { status: 409 })
      }
    }
  }

  // ── UNA RICHIESTA APERTA PER SPEDIZIONE: se chi apre ha già una richiesta 'aperta'/'in_lavorazione'
  //    della STESSA categoria SULLA STESSA spedizione, non ne può aprire un'altra finché quella non è
  //    risolta (evita i doppioni: es. reale TK-00095 + TK-00104 sulla stessa LDV). Il blocco è
  //    PER-SPEDIZIONE: su un'ALTRA spedizione può aprire liberamente. Vale sia per i ticket sia per le
  //    POD. Se il ticket non è collegato a una spedizione (LDV non riconosciuta) non si blocca nulla:
  //    non c'è un perimetro su cui deduplicare. ──
  if (record.spedizione_id) {
    let q = admin.from('tickets').select('codice,cliente_id')
      .eq('categoria', categoria)
      .eq('spedizione_id', record.spedizione_id)
      .in('stato', ['aperto', 'in_lavorazione'])
    // Per il ticket aperto PER il cliente conta anche quello che il cliente ha gia' aperto da se'
    // (o che il master gli ha gia' aperto): la spedizione ha UNA conversazione col cliente, e il
    // master la porta avanti — e se serve la inoltra — da quella. Conta anche un vecchio ticket del
    // master verso la sua linea superiore ancora aperto sulla stessa spedizione.
    q = ruolo === 'cliente'
      ? q.eq('cliente_id', utente!.cliente_id)
      : perCliente
        ? q.or(`cliente_id.eq.${record.cliente_id},and(aperto_master_id.eq.${masterId},tipo_apertura.eq.master)`)
        : q.eq('aperto_master_id', masterId).eq('tipo_apertura', 'master')
    const { data: gia } = await q.limit(1).maybeSingle()
    if (gia) {
      if (perCliente && (gia as any).cliente_id) {
        return NextResponse.json({ error: `${record.aperto_da} ha già un ticket aperto su questa spedizione (${(gia as any).codice}): lo trovi in Assistenza. Scrivi lì e, se serve, inoltralo da lì al tuo master superiore.` }, { status: 400 })
      }
      const cosa = categoria === 'pod' ? 'una richiesta POD aperta' : 'una richiesta di assistenza aperta'
      return NextResponse.json({ error: `Hai già ${cosa} su questa spedizione (${(gia as any).codice}): aspetta che sia risolta prima di aprirne un'altra.` }, { status: 400 })
    }
  }

  // Allegati (foto/PDF) — solo sui ticket
  const allegatiIn = Array.isArray(body?.allegati) ? body.allegati.slice(0, 10) : []
  const allegatiOut: any[] = []
  for (let i = 0; i < allegatiIn.length; i++) {
    const a = allegatiIn[i]
    try {
      const dati = String(a?.dati || '')
      const b64 = dati.split(',').pop() || dati
      if (!b64) continue
      const buffer = Buffer.from(b64, 'base64')
      const nomePulito = String(a?.nome || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
      const ct = String(a?.tipo || 'application/octet-stream')
      const path = `allegati/${masterId}/${Date.now()}_${i}_${nomePulito}`
      const { error: upErr } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType: ct, upsert: true })
      // Si salva il PERCORSO, non un URL pubblico: il bucket e' privato e l'allegato esce solo da
      // /api/file, che prima controlla che chi scarica sia davvero parte di questa richiesta.
      if (!upErr) allegatiOut.push({ url: path, nome: String(a?.nome || 'file'), tipo: ct })
    } catch { /* salta l'allegato non valido */ }
  }
  if (allegatiOut.length) record.allegati = allegatiOut

  const { data, error } = await admin.from('tickets').insert(record).select('id,codice').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Primo messaggio del thread (la chat): l'apertura stessa.
  if (data?.id) {
    // Chi APRE è sempre il lato "richiedente" della chat = 'cliente' (anche un sotto-master che apre
    // verso la linea superiore: lui chiede, l'owner risponde come 'master'). Coerente con la GET/POST.
    // Eccezione: il master che apre PER il suo cliente scrive come assistenza, esattamente come le
    // sue risposte (POST /api/assistenza/[id]): messaggio pubblico, il cliente lo legge.
    await admin.from('ticket_messaggi').insert(perCliente ? {
      ticket_id: data.id,
      autore: 'master',
      autore_id: user.id,
      autore_nome: [utente?.nome, utente?.cognome].filter(Boolean).join(' ') || 'Assistenza',
      autore_master_id: masterId,
      visibilita: 'pubblico',
      testo: messaggio,
      allegati: allegatiOut.length ? allegatiOut : null,
    } : {
      ticket_id: data.id,
      autore: 'cliente',
      autore_id: user.id,   // chi ha scritto davvero: distingue in chat i "· tu" (il master è condiviso)
      autore_nome: record.aperto_da || (ruolo === 'cliente' ? 'Cliente' : 'Master'),
      testo: messaggio,
      allegati: allegatiOut.length ? allegatiOut : null,
    })
  }
  // ADDEBITO ALL'APERTURA (lib/pod-addebito, una volta sola). Se non riesce, la richiesta resta "da
  // addebitare" e si riprova quando l'assistenza manda la POD: aprirla non si blocca per questo.
  const podAddebitato = categoria === 'pod' && record.cliente_id && data?.id ? await addebitaPod(admin, data.id, user.id) : 0
  // per_cliente: il nome del cliente a cui il ticket appartiene, perche' chi l'ha aperto sappia che
  // il cliente lo legge e che verso l'alto va inoltrato a mano.
  return NextResponse.json({ success: true, id: data?.id, codice: data?.codice, pod_prezzo: record.pod_prezzo ?? null, pod_addebitato: podAddebitato, per_cliente: perCliente ? record.aperto_da : null })
}
