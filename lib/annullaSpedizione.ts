import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { spediamoproCancelShipment, spediamoproGetTracking } from '@/lib/spediamopro'
import type { GambaSpedizione } from '@/lib/condivisione-catena'

// "Il pacco e' nelle mani del corriere". "spedita" da sola NON conta: su molti contratti e' solo la LDV
// accettata, senza scansione. Stesso elenco della guardia della coda d'annullo nel tracking
// (app/api/tracking/aggiorna) e di annulli-recupero-cron. Riesportato da lib/annullo-poste.
export const STATI_PARTITA = ['in_transito', 'in_consegna', 'consegnata', 'in_giacenza', 'non_consegnato', 'reso_mittente']

// Il corriere considera la spedizione GIÀ eliminata/inesistente → possiamo cancellarla anche da Moove.
export function giaEliminataSulCorriere(text: string, status?: number): boolean {
  if (status === 404) return true
  const t = (text || '').toLowerCase()
  return /non trovat|not found|inesistent|does not exist|gi[àa] ?(elimin|annull|cancell)|already ?(delet|cancel|removed)|no longer exists/.test(t)
}

// Detentore REALE del contratto: il master più IN ALTO che possiede questo stesso corriere
// (stesso nome_contratto). È chi deve richiedere l'annullo Spedisci via assistenza.
export async function trovaOwnerContratto(admin: any, corriereMasterId: string, nomeContratto: string | null): Promise<string> {
  let owner = corriereMasterId
  if (!nomeContratto) return owner
  let cur: string | null = corriereMasterId
  for (let i = 0; i < 20 && cur; i++) {
    const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    const parent: string | null = mm?.parent_master_id || null
    if (!parent) break
    const { data: pc } = await admin.from('corrieri').select('id').eq('master_id', parent).eq('nome_contratto', nomeContratto).limit(1).maybeSingle()
    if (pc?.id) { owner = parent; cur = parent } else break
  }
  return owner
}

// Chi detiene DAVVERO il contratto: lo dicono i puntatori (`corrieri.contratto_id` = riga del detentore,
// vedi scripts/contratto-codice-catena.sql), non il nome. Risalire l'albero per nome sbaglia quando un
// master ricompra via codice, con lo stesso nome, un contratto che un suo sotto-master detiene: il caso vero
// e' SDA EXPRESS di SPEDIZIONI EXPRESS (sotto-master di Velox, che lo ricompra col ponte omonimo). Le
// richieste di annullo dei clienti di SPEDIZIONI EXPRESS finivano nella coda di Velox, che non ha l'account
// per annullarle: 9 ferme in coda dall'11/11 al 26/11/2026. Al 26/11 e' l'unico contratto Spedisci, Dielle o
// DVA (su tutti) dove le due strade danno un detentore diverso.
// Senza puntatore (riga vecchia mai collegata) resta la ricerca per nome di prima.
export async function masterDetentore(
  admin: any, corr: { id?: string | null; master_id: string; nome_contratto: string | null; contratto_id?: string | null },
): Promise<string> {
  // Una lettura fallita NON e' "contratto senza puntatore": ripiegare sul nome rifarebbe proprio l'errore che
  // questa funzione corregge (coda a chi non puo' annullare). Si ferma, e chi chiama riprova.
  let contrattoId = corr.contratto_id ?? null
  if (contrattoId === null && corr.id) {
    const { data, error } = await admin.from('corrieri').select('contratto_id').eq('id', corr.id).maybeSingle()
    if (error) throw new Error('contratto non leggibile: ' + error.message)
    contrattoId = (data as any)?.contratto_id || null
  }
  if (contrattoId) {
    const { data: det, error } = await admin.from('corrieri').select('master_id').eq('id', contrattoId).maybeSingle()
    if (error) throw new Error('riga del detentore non leggibile: ' + error.message)
    if ((det as any)?.master_id) return (det as any).master_id
    console.warn('[ANNULLO] riga del detentore non trovata, detentore per nome:', corr.id, contrattoId)
  }
  return trovaOwnerContratto(admin, corr.master_id, corr.nome_contratto)
}

// Invia l'annullo al corriere (SpediamoPro/Spedisci). Ritorna ok=true se annullata (o già
// inesistente sul corriere); ok=false col motivo se il corriere rifiuta (es. già spedita/chiusa).
export async function annullaSpedizioneSulCorriere(
  admin: any,
  sped: { corriere_id: string; raw_response: any; tracking_number: string | null }
): Promise<{ ok: boolean; reason?: string }> {
  const { data: corr } = await admin.from('corrieri').select('tipo,credenziali').eq('id', sped.corriere_id).maybeSingle()
  if (!corr) return { ok: true } // corriere non trovato: procedo lato Moove (nessun orfano gestibile)
  const cred: any = corr.credenziali || {}
  const raw: any = sped.raw_response || {}

  if (corr.tipo === 'spediamopro') {
    const spid = raw.id || raw?.shipmentId || raw?.data?.id || raw?.raw?.data?.id
    if (spid && cred.authcode) {
      const r = await spediamoproCancelShipment(cred.authcode, Number(spid))
      if (!r.ok && !giaEliminataSulCorriere(r.error || '')) {
        // GIA' ANNULLATA DAL FORNITORE: il rifiuto ha la stessa frase di un pacco partito ("Shipment
        // status is not valid for cancellation"), quindi decide lo stato. Caso vero 050228152996379
        // (4/11/2026): annullata sul pannello del fornitore alle 9:25, il nostro annullo delle 9:30
        // respinto con quella frase, e la spedizione rimessa "in lavorazione" col cliente addebitato.
        // Status 0 = annullata, la stessa lettura del giro del tracking (mapStatoSpediamopro).
        try {
          const tr = await spediamoproGetTracking(cred.authcode, Number(spid))
          if (tr.status === 0) return { ok: true }
        } catch {}
        return { ok: false, reason: (r.error || '').slice(0, 160) }
      }
    }
    return { ok: true }
  }

  if (corr.tipo === 'spedisci') {
    const shipId = raw.shipmentId || raw.id
    if ((shipId || sped.tracking_number) && cred.master_domain) {
      let status = 0, body = ''
      try {
        const del = await fetch(`https://${cred.master_domain}/api/v2/shipping/delete`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ increment_id: shipId, trackingNumber: sped.tracking_number }),
        })
        status = del.status
        body = await del.text().catch(() => '')
      } catch (e: any) { body = String(e?.message || e) }
      const ok = status >= 200 && status < 300
      if (!ok && !giaEliminataSulCorriere(body, status)) {
        let msg = ''
        try { msg = JSON.parse(body)?.error || '' } catch {}
        return { ok: false, reason: String(msg || body).slice(0, 160) }
      }
    }
    return { ok: true }
  }

  // TERZO PROVIDER (contratti DVA): NON esiste una chiamata di annullo — verificato sull'intera
  // documentazione. Rispondere ok:true (come faceva il ritorno generico qui sotto) significherebbe
  // marcare la spedizione annullata e RIMBORSARE tutta la catena mentre il pacco continua a
  // viaggiare: soldi restituiti per merce comunque consegnata. Va in coda manuale, sempre.
  if (corr.tipo === 'easyparcel') {
    return { ok: false, reason: 'questo corriere non consente l\'annullo automatico' }
  }

  // CONDIVISIONE (corriere-ponte, tipo='moovexpress'): la spedizione VERA è dal VENDITORE (un'altra gamba
  // della catena, es. il reale Poste dell'owner) e va fermata lato suo. Finché non c'è la propagazione
  // dell'annullo al venditore, rispondere ok:true (come faceva il ritorno generico qui sotto) marcherebbe
  // 'annullata' e RIMBORSEREBBE compratore + catena mentre il pacco continua a viaggiare dal corriere reale
  // = rimborso a vuoto. Come easyparcel/DVA: ok:false → resta in coda, nessun rimborso a vuoto. La
  // propagazione dell'annullo al venditore è un pezzo a parte (dispatch dell'annullo).
  if (corr.tipo === 'moovexpress') {
    return { ok: false, reason: 'l\'annullo di questo contratto va gestito dall\'assistenza' }
  }

  // GLS diretto: si rimborsa SOLO se GLS non ha più la spedizione, o se conferma di averla tolta adesso.
  // Prima l'annullo lato Moove valeva comunque, con DeleteSped "best-effort" e l'esito ignorato, perché si
  // pensava che prima della NOSTRA chiusura GLS non passasse a ritirare. Non è così: il conto GLS si chiude
  // anche da Weblabeling (su quello di Wave il 17/11 c'erano 649 spedizioni create e chiuse fuori dal
  // portale), e il cliente consegna il pacco con l'etichetta in mano. NI665682165 (MSM STUDIO): cancellata
  // il 12/11 alle 10:29 e rimborsata, su GLS era CHIUSA e il pacco il giorno dopo era a Foggia.
  if (corr.tipo === 'gls') {
    // GIÀ TRASMESSA (distinta chiusa = confermata_vettore): GLS consegna il pacco → non annullare a vuoto,
    // mai rimborso su merce che parte. La porta elimina lo blocca già prima; questa è la rete di sicurezza
    // anche per il cron e i percorsi legacy che dovessero passare di qui.
    if ((sped as any).confermata_vettore) return { ok: false, reason: 'GLS già trasmessa (distinta chiusa): non annullabile in automatico' }
    const { numeroNudoGls, statoSpedizioneSuGls, annullaSpedizioneGls } = await import('@/lib/gls')
    const numeroNudo = numeroNudoGls(sped as any)
    // Senza numero GLS non ha mai assegnato la spedizione: su GLS non c'è niente da togliere.
    if (!numeroNudo) return { ok: true }
    // Il registro si cerca nel giorno di nascita: il cron e i pacchi condivisi non passano la data.
    let creata: string | null = (sped as any).created_at || null
    if (!creata && (sped as any).id) {
      const { data: c } = await admin.from('spedizioni').select('created_at').eq('id', (sped as any).id).maybeSingle()
      creata = c?.created_at || null
    }
    const su = creata ? await statoSpedizioneSuGls(cred, numeroNudo, creata) : { stato: 'sconosciuto' as const, motivo: 'data di creazione mancante' }
    if (su.stato === 'assente') return { ok: true }   // già tolta da GLS: nessun pacco parte, il rimborso è giusto
    if (su.stato === 'chiusa') {
      return { ok: false, reason: 'la spedizione risulta già trasmessa a GLS, quindi non è più annullabile in automatico: va gestita direttamente col corriere' }
    }
    // Aperta (o registro non leggibile: due conti GLS non lo consentono): si chiede a GLS di toglierla, e
    // conta solo la sua conferma "Eliminazione ... avvenuta".
    if (su.stato === 'sconosciuto') console.error('[ANNULLO][GLS] registro non leggibile, decide DeleteSped:', numeroNudo, su.motivo)
    if (await annullaSpedizioneGls(cred, numeroNudo)) return { ok: true }
    return { ok: false, reason: 'GLS non ha confermato la cancellazione, riprova tra qualche minuto' }
  }

  // BRT diretto: l'annullo esiste (PUT /delete), ma va tentato DAVVERO — il ritorno generico ok:true
  // qui sotto rimborserebbe tutta la catena mentre BRT (auto-conferma) consegna il pacco. Subito dopo la
  // creazione BRT risponde -153 "in processing" (~1min) e più tardi "già spedita": in entrambi i casi
  // NON è annullabile, quindi ok:false col motivo (resta in coda / da riprovare), mai rimborso a vuoto.
  if (corr.tipo === 'brt') {
    const numericRef = raw.numericRef
    if (!numericRef) return { ok: false, reason: 'riferimento BRT mancante per l\'annullo' }
    const { annullaSpedizioneBrt } = await import('@/lib/brt')
    const a = await annullaSpedizioneBrt(cred, { numericRef, alphaRef: raw.alphaRef })
    if (a.ok || giaEliminataSulCorriere(a.errore || '')) return { ok: true }
    return { ok: false, reason: (a.errore || 'BRT non consente l\'annullo in questo momento').slice(0, 160) }
  }

  // FedEx diretto: come BRT, FedEx AUTO-CONFERMA alla creazione → l'annullo va tentato DAVVERO (PUT
  // /shipments/cancel), mai un rimborso a vuoto mentre il pacco viaggia. Se FedEx conferma l'annullo (o
  // risulta già inesistente) ok:true; altrimenti ok:false col motivo (resta in coda / da riprovare).
  if (corr.tipo === 'fedex') {
    const tn = raw.trackingNumber || sped.tracking_number
    if (!tn) return { ok: false, reason: 'tracking FedEx mancante per l\'annullo' }
    const { annullaSpedizioneFedex } = await import('@/lib/fedex')
    const a = await annullaSpedizioneFedex(cred, String(tn), raw.test === true)
    if (a.ok || giaEliminataSulCorriere(a.errore || '')) return { ok: true }
    return { ok: false, reason: (a.errore || 'FedEx non consente l\'annullo in questo momento').slice(0, 160) }
  }

  // ECOSMOS: annullabile via API finche' non e' stata validata per il giro di ritiro. Il rimborso parte
  // SOLO su un annullo confermato da loro: senza questo ramo si cadeva nell'`ok: true` qui sotto, e si
  // rimborsava un pacco che Ecosmos avrebbe ritirato e fatturato lo stesso.
  if (corr.tipo === 'ecosmos') {
    const numero = raw.numero || sped.tracking_number
    if (!numero) return { ok: false, reason: 'numero Ecosmos mancante per l\'annullo' }
    const { annullaEcosmos } = await import('@/lib/ecosmos')
    const a = await annullaEcosmos({ api_key: String(cred.api_key || '') }, String(numero))
    if (a.annullata) return { ok: true }
    return { ok: false, reason: a.messaggio.slice(0, 160) }
  }

  // SPRING: annullabile via API (VoidShipment) finche' Spring non ha accettato il pacco in hub. Il rimborso parte
  // SOLO su un annullo confermato da loro (ErrorLevel 0): senza questo ramo si cadeva nell'`ok: true` qui
  // sotto e si rimborsava un pacco che Spring avrebbe accettato e fatturato lo stesso.
  if (corr.tipo === 'spring') {
    const numero = raw.numero || sped.tracking_number
    if (!numero) return { ok: false, reason: 'numero Spring mancante per l\'annullo' }
    const { annullaSpring } = await import('@/lib/spring')
    const a = await annullaSpring({ api_key: String(cred.api_key || ''), ambiente: String(cred.ambiente || '') }, String(numero))
    if (a.annullata) return { ok: true }
    return { ok: false, reason: a.messaggio.slice(0, 160) }
  }

  // CIRCUITO INTERNO: non c'e' nessuno a cui mandare l'annullo, il corriere siamo noi. Basta non
  // farlo partire — ma se e' gia' stato consegnato non c'e' piu' niente da fermare, e dire ok
  // qui vorrebbe dire rimborsare cliente e catena per un pacco che il destinatario ha in casa.
  if (corr.tipo === 'interno') {
    const { data: s } = await admin.from('spedizioni').select('stato').eq('tracking_number', sped.tracking_number).maybeSingle()
    if (s?.stato === 'consegnata') return { ok: false, reason: 'la spedizione risulta già consegnata' }
    return { ok: true }
  }

  // DIELLE: non c'e' un annullo via API (la guida non ne ha) e dal loro portale l'utente del detentore non
  // puo' eliminare nemmeno le spedizioni appena create ("Spedizione NON Eliminabile", provato il 12/11 sul
  // conto di LOGIXIA): la cancellazione la fa il fornitore su richiesta. Qui NON si puo' dire ok: senza
  // questo ramo si cadeva nell'`ok: true` qui sotto e si rimborsavano cliente e catena per un pacco che
  // partiva lo stesso. Le porte (elimina, API v1, cron) la mandano nella coda manuale del detentore, che
  // conferma quando il fornitore l'ha cancellata; solo allora parte il rimborso.
  if (corr.tipo === 'dielle') {
    return { ok: false, reason: 'questo corriere non consente l\'annullo automatico: lo richiede il detentore del contratto' }
  }

  return { ok: true }
}

// Storno del credito speso per la spedizione: per ogni addebito reale ('spedizione' E 'rettifica')
// legato alla LDV crea un rimborso dello STESSO importo, a OGNI livello (cliente + master catena).
// Include le RETTIFICHE (correzioni di prezzo sotto-costo): all'annullo va rimborsato costo + rettifica,
// altrimenti il livello resterebbe addebitato della rettifica dopo la cancellazione.
// Idempotente PER-MOVIMENTO (non per-spedizione): ricrea SOLO i rimborsi mancanti. Così una rettifica
// arrivata DOPO il primo rimborso viene comunque stornata, e un pacco annullato da una porta vecchia
// che non aveva mai rimborsato viene finalmente coperto.
export async function rimborsaAnnulloSpedizione(
  admin: any,
  sped: { id: string; numero: string; dest_nome?: string | null },
  createdBy: string | null
): Promise<void> {
  try {
    // La commissione MoovExpress vive su un CONTO A PARTE (masters.commissioni_moovexpress), non su
    // credito/credito_proprio: la storna una RPC dedicata, NON il ciclo sotto (che passerebbe da
    // registra_movimento_master e finirebbe su credito_proprio, il conto sbagliato — ci era gia'
    // successo). Chiamata PRIMA della guardia di idempotenza e in un try/catch suo: la RPC e'
    // idempotente di suo (NOT EXISTS), cosi' se un annullo precedente aveva creato i rimborsi ma
    // fallito lo storno-commissione, qui lo ritenta invece di restare bloccato dalla guardia.
    try {
      await admin.rpc('storna_fee_moovexpress', { p_spedizione_id: sped.id, p_numero: sped.numero, p_created_by: createdBy })
    } catch (e) { console.error('Errore storno commissione MoovExpress su annullo:', e) }

    // IDEMPOTENZA PER-MOVIMENTO. La vecchia guardia "se esiste un qualsiasi rimborso → esci" lasciava
    // NON stornate le rettifiche/riprezzi arrivati DOPO il primo rimborso (28 pacchi, ~200 EUR a
    // clienti/master che restavano addebitati su spedizioni annullate) e saltava i pacchi mai rimborsati
    // da porte vecchie. Ora si confronta ogni addebito col suo rimborso-opposto gia' esistente e si crea
    // solo cio' che manca. Vale la coppia (ledger-colonna + importo), consumata 1-a-1 per gestire
    // addebiti identici ripetuti. (L'over-refund da riscrittura in-place dell'importo e' un caso a parte,
    // chiuso alla radice dal trigger append-only su movimenti.importo: qui non lo si puo' sanare creando
    // altri rimborsi.)
    // Letture fallite = non si sa cosa e' gia' stato rimborsato: meglio nessun rimborso (lo riprende la coda
    // annulli_da_rimborsare, che rilegge) che rimborsare tutto una seconda volta.
    const { data: addebiti, error: errAdd } = await admin.from('movimenti')
      .select('cliente_id,master_id,master_target_id,importo')
      .eq('spedizione_id', sped.id).in('tipo', ['spedizione', 'rettifica'])
    if (errAdd) throw new Error('addebiti non leggibili: ' + errAdd.message)
    if (!addebiti?.length) return
    const { data: rimbEsistenti, error: errRimb } = await admin.from('movimenti')
      .select('cliente_id,master_id,master_target_id,importo')
      .eq('spedizione_id', sped.id).eq('tipo', 'rimborso')
    if (errRimb) throw new Error('rimborsi gia\' fatti non leggibili: ' + errRimb.message)
    const chiaveRimb = (cli: any, mo: any, tg: any, imp: number) =>
      `${cli || ''}|${mo || ''}|${tg || ''}|${imp.toFixed(2)}`
    const giaFatti = new Map<string, number>()
    for (const r of (rimbEsistenti || [])) {
      const k = chiaveRimb(r.cliente_id, r.master_id, r.master_target_id, Number(r.importo || 0))
      giaFatti.set(k, (giaFatti.get(k) || 0) + 1)
    }
    const desc = `Rimborso ${sped.numero} - ${sped.dest_nome || ''}`.trim()
    for (const a of (addebiti || [])) {
      // Storno = importo ESATTAMENTE OPPOSTO all'addebito (nega il segno). Così annulla correttamente
      // sia gli addebiti (spedizione, importo negativo → rimborso positivo) SIA le rettifiche con
      // importo POSITIVO (correzione a credito → storno negativo). Prima usava Math.abs, che sulle
      // rettifiche positive raddoppiava invece di annullare, lasciando un residuo a ogni livello.
      const importo = -Number(a.importo || 0)
      if (!(Math.abs(importo) > 0.0001)) continue
      // Gia' stornato questo addebito? consuma il match 1-a-1 e salta (idempotenza per-movimento).
      const k = chiaveRimb(a.cliente_id, a.master_id, a.master_target_id, importo)
      const n = giaFatti.get(k) || 0
      if (n > 0) { giaFatti.set(k, n - 1); continue }
      try {
        if (a.cliente_id) {
          await registraMovimento(admin, {
            masterId: a.master_id, clienteId: a.cliente_id,
            tipo: 'rimborso', descrizione: desc, riferimento: sped.numero,
            importo, spedizioneId: sped.id, createdBy,
          })
        } else if (a.master_target_id) {
          await registraMovimentoMaster(admin, {
            masterOwnerId: a.master_id, masterTargetId: a.master_target_id,
            tipo: 'rimborso', descrizione: desc, riferimento: sped.numero,
            importo, spedizioneId: sped.id, createdBy,
          })
        }
      } catch (e) { console.error('Errore storno movimento su annullo:', e) }
    }
  } catch (e) { console.error('Errore rimborso su annullo:', e) }
}

// ANNULLO DI UN PACCO A PIU' GAMBE (contratto condiviso fra reti): tutte le gambe annullate, poi lo storno
// di ciascuna con rimborsaAnnulloSpedizione. Sui pacchi condivisi stornare la sola gamba del cliente
// lascerebbe addebitati i master sopra: e' la trappola del 5/10 (Epos Caffe').
// Chi annulla sul corriere lo decide il chiamante (Poste: niente, GLS: DeleteSped): qui solo il portale.
// `richiestoAt` resta sulla riga annullata: da li' partono i 30 giorni di sorveglianza delle Poste.
export async function annullaGambePacco(
  admin: any, gambe: GambaSpedizione[], rich: { richiestoAt?: string | null; da?: string | null },
): Promise<{ gambe: number }> {
  const ids = gambe.map(g => g.spedizioneId)
  // Lettura fallita: niente e' stato toccato, si dice che non e' andata (chi chiama risponde errore e si riprova).
  // Prima tornava "annullata" senza aver scritto ne' rimborsato niente.
  const { data: righe, error: errRighe } = await admin.from('spedizioni').select('id,numero,dest_nome,stato,stato_precedente').in('id', ids)
  if (errRighe) throw new Error('righe del pacco non leggibili: ' + errRighe.message)
  const quando = rich.richiestoAt || new Date().toISOString()
  // Ogni riga si PRENDE: passa ad annullata solo se e' ancora nello stato appena letto. Due richieste insieme
  // sullo stesso pacco (API ripetuta dopo un timeout, cliente e master su due righe) prendono righe diverse e
  // ognuna rimborsa solo le sue: il rimborso non e' mai doppio. Una riga gia' annullata prima di qui non si
  // rimborsa da questa strada: e' entrata nella coda annulli_da_rimborsare quando e' diventata annullata.
  const prese: any[] = []
  const nonScritte: string[] = []
  // Nell'ordine delle gambe (il detentore per ultimo, come lo passano tutti i chiamanti), non in quello in cui le
  // rende il database: se il detentore passasse per primo, il trigger trg_gambe_seguono_detentore annullerebbe le
  // altre righe, gli update qui sotto non le prenderebbero e il loro rimborso slitterebbe alla coda (30 minuti),
  // mentre il portale dice "credito stornato".
  const ordine = new Map(ids.map((id, i) => [id, i]))
  const inOrdine = [...(righe || [])].sort((a: any, b: any) => (ordine.get(a.id) ?? 0) - (ordine.get(b.id) ?? 0))
  for (const r of inOrdine) {
    if (r.stato === 'annullata') continue
    // Una riga in viaggio non si annulla ne' si rimborsa: chi chiama l'ha gia' escluso (paccoPartito, annullo-pacco),
    // ma fra la sua lettura e questa il tracking puo' averla mossa.
    if (STATI_PARTITA.includes(r.stato)) { nonScritte.push(`${r.numero}: risulta ${r.stato}`); continue }
    const { data: presa, error } = await admin.from('spedizioni').update({
      stato: 'annullata',
      // Della gamba in attesa conta lo stato di prima della richiesta; le altre non erano in attesa.
      stato_precedente: ['annullamento_pending', 'annullamento_manuale', 'storno_richiesto'].includes(r.stato) ? (r.stato_precedente || 'in_lavorazione') : r.stato,
      annullamento_richiesto_at: quando,
      annullamento_da: rich.da || null,
      annullamento_owner_id: null,
      annullamento_errore: null,
    }).eq('id', r.id).eq('stato', r.stato).select('id')
    if (error) { nonScritte.push(`${r.numero}: ${error.message}`); continue }
    if (presa?.length) { prese.push(r); continue }
    // Non presa: un'altra porta l'ha cambiata nel frattempo. Se e' annullata ci pensa chi l'ha annullata (o la
    // coda dei rimborsi); se e' andata altrove (coda manuale, in viaggio) il pacco NON e' chiuso, e va detto.
    const { data: ora, error: errOra } = await admin.from('spedizioni').select('stato').eq('id', r.id).maybeSingle()
    if (errOra) { nonScritte.push(`${r.numero}: ${errOra.message}`); continue }
    if (ora?.stato !== 'annullata') nonScritte.push(`${r.numero}: è passata a ${ora?.stato || 'stato sconosciuto'}`)
  }
  // Si rimborsa solo cio' che si e' annullato qui: una riga rimasta attiva non si rimborsa.
  for (const r of prese) await rimborsaAnnulloSpedizione(admin, r, rich.da || null)
  // Lo store non deve restare con l'ordine "Fulfilled" e un tracking morto (vedi lib/shopify).
  try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, prese.map(r => r.id)) } catch {}
  if (nonScritte.length) throw new Error('righe del pacco non annullate: ' + nonScritte.join('; '))
  return { gambe: prese.length }
}
