import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { spediamoproCancelShipment } from '@/lib/spediamopro'

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

  // GLS diretto: prima della chiusura (CloseWorkDay) la spedizione NON è ancora trasmessa a GLS, quindi
  // annullarla lato Moove è già sicuro (GLS non passa a ritirarla). La si rimuove comunque da GLS con
  // DeleteSped (best-effort) per non lasciare numeri appesi. L'esito NON blocca il rimborso: il modello
  // GLS (attesa-chiusura) lo rende sicuro, a differenza di BRT (auto-conferma) qui sotto.
  if (corr.tipo === 'gls') {
    // GIÀ TRASMESSA (distinta chiusa = confermata_vettore): GLS consegna il pacco → non annullare a vuoto,
    // mai rimborso su merce che parte. La porta elimina lo blocca già prima; questa è la rete di sicurezza
    // anche per il cron e i percorsi legacy che dovessero passare di qui.
    if ((sped as any).confermata_vettore) return { ok: false, reason: 'GLS già trasmessa (distinta chiusa): non annullabile in automatico' }
    const numeroNudo = raw.numero ? String(raw.numero) : ''
    // Pre-chiusura la spedizione NON è trasmessa a GLS: l'annullo lato Moove è già sicuro anche se DeleteSped
    // non risponde (GLS non passa a ritirarla). DeleteSped best-effort, per non lasciare numeri appesi.
    if (numeroNudo) {
      try { const { annullaSpedizioneGls } = await import('@/lib/gls'); await annullaSpedizioneGls(cred, numeroNudo) }
      catch (e) { console.error('[ANNULLO][GLS] DeleteSped:', e) }
    }
    return { ok: true }
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

  // CIRCUITO INTERNO: non c'e' nessuno a cui mandare l'annullo, il corriere siamo noi. Basta non
  // farlo partire — ma se e' gia' stato consegnato non c'e' piu' niente da fermare, e dire ok
  // qui vorrebbe dire rimborsare cliente e catena per un pacco che il destinatario ha in casa.
  if (corr.tipo === 'interno') {
    const { data: s } = await admin.from('spedizioni').select('stato').eq('tracking_number', sped.tracking_number).maybeSingle()
    if (s?.stato === 'consegnata') return { ok: false, reason: 'la spedizione risulta già consegnata' }
    return { ok: true }
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
    const { data: addebiti } = await admin.from('movimenti')
      .select('cliente_id,master_id,master_target_id,importo')
      .eq('spedizione_id', sped.id).in('tipo', ['spedizione', 'rettifica'])
    if (!addebiti?.length) return
    const { data: rimbEsistenti } = await admin.from('movimenti')
      .select('cliente_id,master_id,master_target_id,importo')
      .eq('spedizione_id', sped.id).eq('tipo', 'rimborso')
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
