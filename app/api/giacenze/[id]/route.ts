import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente, bloccaAgente } from '@/lib/agente'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { spediamoproSearchStocks, spediamoproReleaseStock } from '@/lib/spediamopro'
import { erroreSvincoloPulito } from '@/lib/errore-corriere'
import { registraMovimento } from '@/lib/movimenti'
import { addebitaServizioGiacenza } from '@/lib/giacenza-cascata'
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
  return NextResponse.json({
    sped, prezzi, prezziControparte, etichettaControparte,
    noloBase: base, noloBaseControparte: baseControparte,
    storico: storico || [], costi: costi || [], ruolo,
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

  // 4) Conferma svincolo (solo master) -> addebito + aggiornamento + invio al corriere
  if (azione === 'conferma_svincolo') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Solo il master puo confermare lo svincolo' }, { status: 403 })
    const { data: rich } = await admin.from('giacenza_richieste').select('*').eq('id', body?.richiestaId).eq('spedizione_id', id).maybeSingle()
    if (!rich) return NextResponse.json({ error: 'Richiesta non trovata' }, { status: 404 })
    if (rich.stato === 'confermata') return NextResponse.json({ error: 'Richiesta gia confermata' }, { status: 400 })

    const { data: costiManuali } = await admin.from('giacenza_costi').select('importo').eq('spedizione_id', id)
    const extra = (costiManuali || []).reduce((s: number, c: any) => s + (Number(c.importo) || 0), 0)
    const totale = +((Number(rich.costo_totale) || 0) + extra).toFixed(2)

    const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }
    const istr = `${opLabel[rich.operazione] || rich.operazione}${rich.data_operazione ? ' - data ' + rich.data_operazione : ''}${rich.note ? ' - ' + rich.note : ''}`

    // Invio dello svincolo al corriere.
    let avviso: string | null = null   // segnalazione non bloccante da mostrare a chi opera
    const cred = sped.corrieri?.credenziali as Record<string, any>
    if (cred?.authcode) {
      // SpediamoPro: rilascio dello STOCK (giacenza). Prima veniva SALTATO (cercava master_domain
      // di Spedisci) → il pacco restava in giacenza sul corriere pur risultando svincolato da noi.
      // Mappa operazione → releaseAction: riconsegna=1, nuovo indirizzo=2 (con alternativeAddress),
      // reso al mittente=3. Se il rilascio fallisce blocco QUI (niente addebito senza svincolo reale).
      const raw: any = sped.raw_response || {}
      const spid = raw.id || raw?.raw?.data?.id
      const code = raw.code || raw?.raw?.data?.code || sped.tracking_number
      const releaseAction = rich.operazione === 'reso' ? 3 : rich.operazione === 'riconsegna_nuovo' ? 2 : 1
      const extra: any = {}
      if (rich.note) extra.instructions = String(rich.note)
      if (releaseAction === 2) {
        const nd = rich.nuovo_destinatario || {}
        extra.alternativeAddress = {
          name: nd.nome || sped.dest_nome || '', address: nd.indirizzo || '', postalCode: nd.cap || '',
          city: nd.citta || '', province: nd.provincia || '', country: 'IT',
          ...(nd.telefono ? { phone: String(nd.telefono) } : {}),
        }
      }
      try {
        const stocks = await spediamoproSearchStocks(cred.authcode, String(code))
        const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && (!spid || Number(st.shipmentId) === Number(spid)))
        if (!attivo?.id) return NextResponse.json({ error: 'Giacenza non più attiva sul corriere (già svincolata o scaduta).' }, { status: 400 })
        // MOTIVO del corriere: lo salvo (serve in elenco) e lo uso solo per AVVISARE.
        const motivo = String(attivo.reason || '')
        if (motivo) { try { await admin.from('spedizioni').update({ giacenza_motivo: motivo.slice(0, 200) }).eq('id', id) } catch {} }
        // NIENTE BLOCCHI sulla causale: i corrieri a volte registrano un motivo di giacenza
        // sbagliato (un "rifiuto" che rifiuto non era, un indirizzo dato per errato che invece
        // e' buono). Impedire la riconsegna su quella base bloccava operazioni legittime, e per
        // giunta solo al master: dal portale cliente la stessa richiesta passava comunque.
        // Si avvisa e si lascia decidere a chi opera; se il corriere rifiuta davvero, il suo
        // errore viene mostrato pulito da erroreSvincoloPulito.
        if (/rifiut|refus|respint/i.test(motivo) && releaseAction !== 3) {
          avviso = `Il corriere aveva registrato "${motivo}": su un pacco rifiutato la riconsegna viene spesso respinta. Se non va a buon fine, resta il "Reso al mittente".`
          console.warn('[GIACENZA] riconsegna su pacco con motivo rifiuto', { spedizione: id, motivo, releaseAction })
        }
        // Indirizzo errato/incompleto/sconosciuto: riconsegnare allo STESSO indirizzo ha buone
        // probabilita' di fallire di nuovo, ma NON e' impossibile (il corriere a volte ritenta e
        // consegna). Prima era un blocco: il master si vedeva negare un'operazione che il cliente
        // dal suo portale poteva fare comunque. Ora si avvisa e si lascia decidere a chi opera.
        if (/indirizzo\s*(errato|inesistente|incompleto)|sconosciut|manca civico|incompl/i.test(motivo) && releaseAction === 1) {
          avviso = `Il corriere aveva segnalato "${motivo}": la riconsegna allo stesso indirizzo potrebbe fallire di nuovo. Se non va a buon fine, usa "Riconsegna a nuovo indirizzo" o "Reso al mittente".`
          console.warn('[GIACENZA] riconsegna stesso indirizzo con motivo indirizzo errato', { spedizione: id, motivo })
        }
        await spediamoproReleaseStock(cred.authcode, Number(attivo.id), releaseAction, extra)
      } catch (e: any) {
        return NextResponse.json({ error: erroreSvincoloPulito(e) }, { status: 400 })
      }
    } else if (sped.corrieri?.tipo === 'easyparcel' && cred?.apikey) {
      // CONTRATTO V: lo svincolo si chiede con la lettera di vettura, non con un id di giacenza.
      //
      // Finche' questo ramo non c'era, una giacenza di questo contratto non veniva mandata a
      // nessuno: da noi risultava svincolata, dal corriere il pacco restava fermo in deposito a
      // maturare giorni finche' non tornava indietro da solo. E' lo stesso guasto che c'era gia'
      // stato sull'altro contratto.
      //
      // Le nostre tre operazioni diventano le loro: riconsegna = consegnare al destinatario,
      // reso = riportarlo al mittente, nuovo indirizzo = portarlo altrove. La quarta che loro
      // hanno, distruggere il pacco, non la esponiamo: e' irreversibile e nessuno la chiede da
      // un portale.
      const { easyparcelSvincolo } = await import('@/lib/easyparcel')
      const azioneV = rich.operazione === 'reso' ? 'M' : rich.operazione === 'riconsegna_nuovo' ? 'N' : 'D'
      const nd = rich.nuovo_destinatario || {}
      try {
        const esito = await easyparcelSvincolo(cred.apikey, String(sped.numero || sped.tracking_number), azioneV as any, {
          // Le note stanno in 65 caratteri: ci mettiamo l'operazione e la data, che sono quello
          // che serve a chi in deposito deve capire cosa fare.
          note: istr,
          telefonoDestinatario: nd.telefono || sped.dest_telefono || '',
          nuovoIndirizzo: azioneV === 'N' ? {
            cognome: nd.nome || sped.dest_nome || '',
            indirizzo: nd.indirizzo || '',
            cap: nd.cap || '', localita: nd.citta || '', provincia: nd.provincia || '',
            telefono: nd.telefono || '',
          } : undefined,
        })
        // Il costo che ci addebita il corriere e' suo e non c'entra col prezzo che facciamo al
        // cliente: si annota accanto alla richiesta, cosi' a fine mese si puo' confrontare.
        try {
          await admin.from('giacenza_richieste')
            .update({ note: [rich.note, `[corriere: ${esito.azione} - € ${esito.importo.toFixed(2)}${esito.idGiacenza ? ' - rif ' + esito.idGiacenza : ''}]`].filter(Boolean).join(' ') })
            .eq('id', rich.id)
        } catch {}
        console.log('[GIACENZA][V] svincolo registrato', sped.numero, esito.azione, esito.importo)
      } catch (e: any) {
        // Niente addebito senza svincolo vero: si blocca qui, come sull'altro contratto.
        return NextResponse.json({ error: erroreSvincoloPulito(e) }, { status: 400 })
      }
    } else if (cred?.master_domain && cred?.password && sped.tracking_number) {
      // Spedisci.online: delivery-instructions (invariato)
      try {
        await fetch(`https://${cred.master_domain}/api/v2/shipping/delivery-instructions/${sped.tracking_number}`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: istr, operation: rich.operazione, new_recipient: rich.nuovo_destinatario || undefined }),
        })
      } catch (e) { console.error('Errore invio svincolo al corriere:', e) }
    }

    // SVINCOLO: si addebita SOLO il servizio scelto (riconsegna/reso/…). L'APERTURA è già stata
    // addebitata all'ENTRATA in giacenza (dal cron). Cliente + cascata rete (solo servizio).
    //
    // Il RESO non guarda giacenza_addebito_effettuato. Un pacco puo' finire in giacenza DUE volte:
    // prima riconsegna (che marca l'addebito come fatto), la riconsegna fallisce, e al secondo giro
    // si sceglie il reso. Con la guardia unica quel reso non lo pagava nessuno — ne' il cliente ne'
    // la rete — e veniva pure marcato come addebitato, quindi la scansione in sede lo saltava per
    // sempre. Il doppio addebito lo impedisce l'indice unico nel database, non questo flag.
    let resoAddebitato = false
    let importoResoCliente = 0
    if (rich.operazione === 'reso') {
      const esito = await addebitaServizioGiacenza(
        { id, numero: sped.numero, cliente_id: sped.cliente_id, master_id: sped.master_id, corriere_id: sped.corriere_id },
        'reso', 0
      )
      resoAddebitato = esito.addebitato
      importoResoCliente = esito.importoCliente
    }
    if (!sped.giacenza_addebito_effettuato) {
      if (rich.operazione !== 'reso') {
        await addebitaServizioGiacenza(
          { id, numero: sped.numero, cliente_id: sped.cliente_id, master_id: sped.master_id, corriere_id: sped.corriere_id },
          rich.operazione, Number(rich.costo_servizio) || 0
        )
      }
      // Eventuali costi manuali aggiunti dal master: una voce a parte al cliente.
      if (extra > 0) {
        await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
          descrizione: `Costi giacenza ${sped.numero}`, riferimento: sped.numero, importo: -Math.abs(extra), spedizioneId: id })
      }
    }

    await admin.from('giacenza_richieste').update({ stato: 'confermata', confermata_da: nomeUtente, confermata_at: new Date().toISOString() }).eq('id', rich.id)

    // Se lo SVINCOLO è un RESO: la spedizione entra in "reso al mittente" e va SUBITO chiusa in una
    // distinta resi (già addebitata qui a cascata), così l'Elenco mostra "Distinta N" sotto lo stato
    // e la scansione resi la riconosce come già addebitata (nessun doppio addebito).
    let numeroDistintaReso: number | null = null
    if (rich.operazione === 'reso' && sped.cliente_id) {
      // Evita duplicati: solo se non è già in una distinta resi del master.
      const { data: esistenti } = await admin.from('distinte_resi').select('voci').eq('master_id', sped.master_id)
      const gia = new Set<string>()
      for (const d of (esistenti || [])) for (const v of (Array.isArray((d as any).voci) ? (d as any).voci : [])) if (v?.id) gia.add(v.id)
      if (!gia.has(id)) {
        const { count } = await admin.from('distinte_resi').select('id', { count: 'exact', head: true }).eq('master_id', sped.master_id)
        numeroDistintaReso = (count || 0) + 1
        await admin.from('distinte_resi').insert({
          master_id: sped.master_id, cliente_id: sped.cliente_id, numero: numeroDistintaReso,
          // In distinta va quello che e' stato addebitato DAVVERO, non il preventivo congelato
          // nella richiesta: il prezzo lo decide il database al momento dell'addebito.
          totale_ldv: 1, totale: importoResoCliente,
          voci: [{ id, numero: sped.numero }], stato: 'chiusa',
        })
      }
    }

    // La spedizione resta nella lista giacenze come "svincolata" (verde: svincolo confermato);
    // per il RESO imposto anche stato='reso_mittente' (la lista giacenze filtra su giacenza_stato, resta visibile).
    await admin.from('spedizioni').update({
      giacenza_stato: 'svincolata', giacenza_istruzioni: istr, giacenza_addebito_effettuato: true,
      // Se lo svincolo è un RESO, il reso è già stato addebitato qui (a cascata): lo marco così la
      // scansione resi mostrerà "reso già addebitato in giacenza" e NON riaddebiterà.
      // Il flag si scrive solo se l'addebito e' passato davvero: marcarlo senza averlo addebitato
      // significava togliere quel reso anche alla scansione in sede, e non pagarlo mai piu'.
      ...(rich.operazione === 'reso' ? { stato: 'reso_mittente', ...(resoAddebitato ? { giacenza_reso_addebitato: true } : {}) } : {}),
    }).eq('id', id)
    return NextResponse.json({ success: true, addebito: totale, distintaReso: numeroDistintaReso, avviso })
  }

  // 5) Chiudi giacenza (solo master) -> non piu gestibile
  if (azione === 'chiudi') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Solo il master puo chiudere la giacenza' }, { status: 403 })
    await admin.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}
