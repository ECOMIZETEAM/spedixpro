import { NextRequest, NextResponse, after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { verificaCreditoCatena, addebitaCatena } from '@/lib/cascata'
import { calcolaPrezzoCorriere, calcolaPrezzoCorriereDettaglio, calcolaSupplementiCliente, fattoreVolumeCliente, fattoreVolumeCorriere, calcolaPesoFatturato, calcolaPrezzoListino } from '@/lib/pricing'
import { isAgente, nomeAgente } from '@/lib/agente'
import { EMAIL_PER_CORRIERE,
  spediamoproGetQuotation,
  spediamoproCreateShipment,
  telValidoSp,
  spediamoproGetLabel,
  normalizzaEtichetta,
  spediamoproWaitForTracking,
  spediamoproCancelShipment,
  kgToGrams, cmToMm, euroToCents, centsToEuro
} from '@/lib/spediamopro'

// Messaggio pulito quando il corriere rifiuta la spedizione: MAI il nome del provider
// (SpediamoPro/Spedisci.online) né il testo grezzo dell'API. Deduce la causa dai keyword.
function erroreCorrierePulito(raw: any): string {
  const t = String(raw || '').toLowerCase()
  if (/timed\s*out|timeout|0 bytes received/.test(t))
    return 'Il corriere non ha risposto in tempo (rallentamento momentaneo dei suoi sistemi). Riprova tra qualche istante.'
  if (/\bphone\b|telefono/.test(t))
    return 'Telefono del mittente mancante o non valido: inserisci un numero di telefono (solo cifre) e riprova.'
  if (/dimension|misur|measure|\bsize\b|volume|lato|length|width|height|weight|\bpeso\b|\bkg\b|oversiz|too (large|big|heavy)/.test(t))
    return 'Collo non ammesso dal corriere: verifica misure e peso (potrebbe essere fuori misura).'
  if (/provinc|state|postal|\bzip\b|address|indiriz|\bcap\b|city|citt|recipient|consignee|sender|destinat|mittent/.test(t))
    return 'Indirizzo non valido: controlla nome, indirizzo, città, provincia e CAP di mittente e destinatario.'
  if (/\bcod\b|cash.?on.?delivery|contrassegn/.test(t))
    return 'Contrassegno non gestibile da questo contratto (non previsto o importo oltre il massimo). Rimuovilo o scegli un altro contratto.'
  if (/insur|assicur/.test(t))
    return 'Assicurazione non gestibile da questo contratto (non prevista o valore oltre il massimo).'
  if (/nessuna tariffa|no rate|not available|non disponibile|quotation|service.*not|servizio.*non/.test(t))
    return 'Nessuna tariffa disponibile per questa destinazione con il contratto scelto: prova un altro contratto.'
  if (/auth|token|unauthor|forbidden|credential|credenzial|domain|enotfound|fetch failed|econn|network|master_domain/.test(t))
    return 'Contratto non configurato correttamente (credenziali/dominio mancanti). Contatta l\'assistenza.'
  // Ultima risorsa: messaggio generico, MA con un frammento ripulito della causa (senza nome provider)
  const pulito = String(raw || '').replace(/spediamo\s*pro|spedisci\.?online|core\.spediamopro\.com|https?:\/\/[^\s]+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return 'Il corriere non può gestire questa spedizione' + (pulito ? ` (${pulito})` : ': verifica misure, peso, indirizzo e servizi, oppure scegli un altro contratto.')
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const body = await req.json()
  // L'agente può creare spedizioni SOLO per i SUOI clienti: niente spedizione propria (__proprio__)
  // né per sotto-master (m:); il cliente dev'essere assegnato a lui (verifica sotto).
  if (isAgente(utente) && (body.clienteId === '__proprio__' || (typeof body.clienteId === 'string' && body.clienteId.startsWith('m:')))) {
    return NextResponse.json({ error: 'Operazione non consentita.' }, { status: 403 })
  }

  // Extra/servizi accessori scelti per questa spedizione (li paga il cliente): [{nome, importo}].
  // L'importo è già incluso in body.totalPrice (calcolato lato frontend dal listino); qui salviamo
  // il dettaglio per riga così il report può riportarlo voce per voce.
  const serviziAccessori = Array.isArray(body.serviziAccessori)
    ? body.serviziAccessori
        .map((s:any) => ({ nome: String(s?.nome || '').slice(0,120), importo: Math.round((Number(s?.importo)||0)*100)/100 }))
        .filter((s:any) => s.nome && s.importo)
    : null

  // Spedizione PER CONTO DI UN SOTTO-MASTER (clienteId = "m:<id>"): trattato come un cliente,
  // col LISTINO CHE GLI HAI ASSEGNATO (masters.parent_listino_id) → stesse identiche funzioni
  // (peso volume, contrassegni, sponda, misure). Si addebita il credito del sotto-master.
  const subMatch = (typeof body.clienteId === 'string' && body.clienteId.startsWith('m:')) ? body.clienteId.slice(2) : null
  let masterSub: string | null = null
  let subListino: string | null = null
  let subCredito = 0, subTipo = ''
  if (subMatch && utente?.ruolo !== 'cliente' && utente?.master_id) {
    const { createAdminSupabase: _adm } = await import('@/lib/supabase-admin')
    const _a = _adm()
    const { data: sm } = await _a.from('masters').select('parent_master_id,parent_listino_id,credito,tipo_contratto').eq('id', subMatch).maybeSingle()
    if (!sm || sm.parent_master_id !== utente.master_id) return NextResponse.json({ error: 'Sotto-master non autorizzato' }, { status: 403 })
    if (!sm.parent_listino_id) return NextResponse.json({ error: 'Il sotto-master non ha un listino assegnato.' }, { status: 400 })
    masterSub = subMatch; subListino = sm.parent_listino_id; subCredito = Number(sm.credito || 0); subTipo = sm.tipo_contratto || ''
  }

  // Spedizione propria del master (nessun cliente): costo = listino corriere.
  const isProprio = utente?.ruolo !== 'cliente' && body.clienteId === '__proprio__'

  const clienteId = utente?.ruolo === 'cliente' ? utente.cliente_id : ((isProprio || masterSub) ? null : body.clienteId)
  let cliente: any = null
  if (masterSub) {
    cliente = { master_id: utente!.master_id, listino_cliente_id: subListino, tipo_contratto: subTipo, credito: subCredito, ragione_sociale: 'Sotto-master' }
  } else if (!isProprio) {
    const { data } = await supabase.from('clienti').select('master_id,ragione_sociale,listino_cliente_id,vieta_inserimento,tipo_contratto,credito,agente').eq('id', clienteId).single()
    cliente = data
    if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
    // Agente: il cliente dev'essere assegnato a lui.
    if (isAgente(utente) && (cliente.agente || '').trim() !== nomeAgente(utente)) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
    if (utente?.ruolo === 'cliente' && cliente.vieta_inserimento === true) return NextResponse.json({ error: 'Inserimento spedizioni non consentito per questo cliente.' }, { status: 403 })
    // Niente listino assegnato = niente contratto: non si può spedire.
    if (!cliente.listino_cliente_id) return NextResponse.json({ error: 'Nessun contratto attivo' }, { status: 400 })
  }

  // ── Blocco credito insufficiente ("credito a scalare"): vale per CLIENTE, SOTTO-MASTER e
  //    MASTER su spedizione propria. Se il credito non copre il costo della spedizione, non si può
  //    spedire (es. credito 2€ ma spedizione 3€). Il ROOT master (senza padre) è esente.
  {
    const costoPreventivo = parseFloat(body.totalPrice) || 0
    let tipoC = '', creditoC = 0, esente = false
    if (cliente) { tipoC = cliente.tipo_contratto || ''; creditoC = Number(cliente.credito || 0) }
    else if (isProprio) {
      const { data: m } = await supabase.from('masters').select('tipo_contratto,credito,parent_master_id').eq('id', utente!.master_id).maybeSingle()
      tipoC = (m as any)?.tipo_contratto || ''; creditoC = Number((m as any)?.credito || 0); esente = !(m as any)?.parent_master_id
    }
    if (!esente && tipoC === 'credito_scalare' && costoPreventivo > 0 && creditoC < costoPreventivo) {
      return NextResponse.json({
        error: `Credito insufficiente: disponibili € ${creditoC.toFixed(2)}, spedizione € ${costoPreventivo.toFixed(2)}. Ricarica il credito per spedire.`,
      }, { status: 402 })
    }
  }

  const masterId = isProprio ? utente!.master_id : cliente.master_id

  let corriereRecord: any = null

  // Il corriere puo' appartenere a un master ANTENATO nella catena (contratti condivisi a discesa).
  // RLS: lettura via admin; autorizzazione = check catena qui sotto.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminCrea = createAdminSupabase()
  if (body._corriere_id) {
    const { data: c } = await adminCrea
      .from('corrieri').select('id,tipo,credenziali,nome_contratto,attivo,master_id,settings,multicollo')
      .eq('id', body._corriere_id)
      .single()
    if (c) {
      let cur: string | null = masterId
      let legittimo = false
      for (let i = 0; i < 20 && cur; i++) {
        if (cur === c.master_id) { legittimo = true; break }
        const { data: mm } = await adminCrea.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        cur = mm?.parent_master_id || null
      }
      if (legittimo) corriereRecord = c
    }
    if (!corriereRecord) {
      return NextResponse.json({ error: 'Corriere selezionato non disponibile per questo master.' }, { status: 400 })
    }
  }

  // Fallback: primo corriere del listino (compatibilità)
  if (!corriereRecord && cliente?.listino_cliente_id) {
    const { data: fascia } = await supabase
      .from('listini_clienti_fasce')
      .select('corrieri(id,tipo,credenziali,nome_contratto,attivo,master_id)')
      .eq('listino_id', cliente.listino_cliente_id)
      .limit(1)
      .single()
    corriereRecord = (fascia as any)?.corrieri
  }

  if (!corriereRecord) {
    const { data: c } = await supabase
      .from('corrieri').select('id,tipo,credenziali,nome_contratto,attivo,master_id,settings,multicollo')
      .eq('master_id', masterId).eq('tipo', 'spedisci')
      .limit(1)
      .single()
    corriereRecord = c
  }

  if (!corriereRecord) return NextResponse.json({ error: 'Nessun corriere configurato' }, { status: 400 })

  if (corriereRecord.attivo === false) return NextResponse.json({ error: 'Corriere in pausa: spedizione non consentita.' }, { status: 400 })

  // Contenuto OBBLIGATORIO per i servizi internazionali (es. Poste International Plus): serve alla
  // dogana e senza il corriere rifiuta la creazione con un errore poco chiaro. Blocco qui con
  // un messaggio pulito.
  if (/international/i.test(String(corriereRecord.nome_contratto || '')) && !String(body.contenuto || '').trim()) {
    return NextResponse.json({ error: 'Contenuto obbligatorio per questo servizio internazionale: indica la descrizione della merce.' }, { status: 400 })
  }

  const cred = corriereRecord.credenziali as Record<string, string>

  if (!body.shipTo?.state?.trim()) return NextResponse.json({ error: 'Provincia destinatario obbligatoria' }, { status: 400 })
  if (!body.shipFrom?.state?.trim()) return NextResponse.json({ error: 'Provincia mittente obbligatoria' }, { status: 400 })

  const packages = body.packages || [{ length: 20, width: 15, height: 10, weight: 1 }]
  // *** Controllo misure massime del corriere (settings.misure_max) ***
  // *** Controllo multicollo ***
  if (packages.length > 1 && (corriereRecord as any)?.multicollo === false) {
    return NextResponse.json({ error: 'Il contratto non prevede la funzione multicollo' }, { status: 400 })
  }
  const mmax = (corriereRecord as any)?.settings?.misure_max
  if (mmax && (mmax.lunghezza || mmax.larghezza || mmax.altezza)) {
    const maxL = parseFloat(mmax.lunghezza) || Infinity
    const maxW = parseFloat(mmax.larghezza) || Infinity
    const maxH = parseFloat(mmax.altezza) || Infinity
    for (const pk of packages) {
      const L = parseFloat(pk?.length) || 0, W = parseFloat(pk?.width) || 0, H = parseFloat(pk?.height) || 0
      if (L > maxL || W > maxW || H > maxH) {
        return NextResponse.json({ error: 'Volume troppo alto. Misure massime consentite: ' + (mmax.lunghezza||'-') + ' x ' + (mmax.larghezza||'-') + ' x ' + (mmax.altezza||'-') + ' cm' }, { status: 400 })
      }
    }
  }
  const pkg = packages[0]
  // Peso reale = SOMMA di tutti i colli (multicollo), non solo il primo: il costo della spedizione
  // propria (costoMaster) deve coincidere col movimento a cascata, che usa già la somma.
  const pesoReale = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1

  // *** Blocco servizio contrassegno/assicurazione non previsto dal contratto ***
  // Regola uniforme: se il servizio non esiste (valore_max 0/assente) o l'importo supera il
  // massimo configurato, il corriere NON è disponibile e non si può spedire (master e cliente).
  {
    const codReq = Number(body.codValue || 0)
    const assReq = Number(body.insuranceValue || 0)
    if (codReq > 0 || assReq > 0) {
      if (isProprio) {
        const dett = await calcolaPrezzoCorriereDettaglio(adminCrea, {
          corriereId: corriereRecord.id, masterId,
          provincia: body.shipTo.state, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
          pesoReale, packages, contrassegno: codReq, assicurazione: assReq,
        })
        if (dett?.contrassegnoOltreMax) return NextResponse.json({ error: 'Il contratto selezionato non prevede il contrassegno per questo importo.' }, { status: 400 })
        if (dett?.assicurazioneOltreMax) return NextResponse.json({ error: 'Il contratto selezionato non prevede l\'assicurazione per questo importo.' }, { status: 400 })
      } else if (cliente?.listino_cliente_id) {
        const sup = await calcolaSupplementiCliente(adminCrea, {
          listinoId: cliente.listino_cliente_id, corriereId: corriereRecord.id,
          contrassegno: codReq, assicurazione: assReq, valoreMerce: Number(body.valoreMerce || 0), nolo: 0,
        })
        if (!sup.disponibile) return NextResponse.json({ error: 'Il contratto non prevede il contrassegno o l\'assicurazione per questo importo. Rimuovili o scegli un altro corriere.' }, { status: 400 })
      }
    }
  }

  // *** Blocco ZONA ESCLUSIVA senza prezzo a listino (Zone Disagiate / Isole / …) ***
  // Regola: se il CAP di destinazione è in una zona ESCLUSIVA per QUESTO corriere (es. "Zone
  // Disagiate", "Isole Minori") e il listino del cliente NON prezza quella zona, il corriere NON è
  // vendibile lì — altrimenti ripiega su "Italia"/"Sardegna" e si vende sotto costo. La tariffe/route
  // lo esclude già nel preventivo; questo è il gate LATO SERVER, che non si fida di body.totalPrice
  // (che potrebbe arrivare da un preventivo stale o dalla creazione manuale del master).
  // calcolaPrezzoListino (con le zone esclusive del master tra le candidate) ritorna il corriere solo
  // se ha davvero una fascia per la destinazione: se torna un ALTRO corriere (o null), è escluso.
  if (!isProprio && cliente?.listino_cliente_id && (body.shipTo.country || 'IT').toUpperCase() === 'IT') {
    const risCli = await calcolaPrezzoListino(adminCrea, {
      listinoId: cliente.listino_cliente_id, corriereId: corriereRecord.id,
      provincia: body.shipTo.state, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT',
      citta: body.shipTo.city,   // CAP condivisi (es. 65010 Spoltore/Civitella Casanova): senza città il gate vedeva disagiata anche per il comune normale
      packages,
    })
    if (!risCli || risCli.corriere_id !== corriereRecord.id) {
      return NextResponse.json({ error: 'Destinazione in zona disagiata: nessun prezzo a listino per questo corriere. Spedizione non consentita — scegli un altro corriere o aggiungi la fascia della zona al listino.' }, { status: 400 })
    }
  }

  // Spedizione propria del master: prezzo dal listino corriere (server-side, non ci fidiamo del body).
  let costoMaster = 0
  if (isProprio) {
    costoMaster = (await calcolaPrezzoCorriere(adminCrea, {
      corriereId: corriereRecord.id, masterId,
      provincia: body.shipTo.state, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
      pesoReale, packages,
      contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
    })) ?? (parseFloat(body.totalPrice) || 0)
  }

  // Peso fatturato/volumetrico da SALVARE sulla spedizione (colonna Peso in elenco), col fattore
  // volume EFFETTIVO per quel corriere: cliente/sotto-master -> listino cliente; propria -> listino corriere.
  let pesoVolCalc = 0, pesoFattCalc = pesoReale
  try {
    const fattoreVol = isProprio
      ? await fattoreVolumeCorriere(adminCrea, masterId, corriereRecord.id)
      : await fattoreVolumeCliente(adminCrea, cliente?.listino_cliente_id, corriereRecord.id)
    const pf = calcolaPesoFatturato(packages, fattoreVol)
    pesoVolCalc = Math.round(pf.pesoVolume * 100) / 100
    pesoFattCalc = Math.round(pf.pesoFatturato * 100) / 100
  } catch {}

  // Helper: registra la detrazione del credito dopo una spedizione riuscita.
  // Non deve mai far fallire la spedizione (è già creata sul corriere + DB).
  async function addebitaCredito(spedizioneId: string | null, numeroSped: string, costo: number) {
    // Spedizione propria del master: NON addebito qui. Ci pensa addebitaCatena (sotto),
    // che risale la catena fino al proprietario REALE del contratto e registra un
    // movimento 'spedizione' per OGNI master del ramo (incluso questo). Così la
    // spedizione risale correttamente in lista movimenti a tutta la catena.
    if (isProprio) return
    // Per conto di un sotto-master: addebito il CREDITO del sotto-master (come un cliente).
    if (masterSub) {
      if (!(costo > 0)) return
      try {
        await registraMovimentoMaster(adminCrea, {
          masterOwnerId: masterId,       // il master che incassa (proprietario del listino)
          masterTargetId: masterSub,     // il sotto-master a cui si scala il credito
          tipo: 'spedizione',
          descrizione: `${numeroSped} - ${body.shipTo?.name || ''}`.trim(),
          riferimento: numeroSped,
          importo: -Math.abs(costo),
          spedizioneId,
          createdBy: user!.id,
        })
      } catch (e) {
        console.error('Errore movimento spedizione sotto-master:', e)
      }
      return
    }
    if (!(costo > 0)) return
    try {
      await registraMovimento(supabase, {
        masterId,
        clienteId,
        tipo: 'spedizione',
        descrizione: `${numeroSped} - ${body.shipTo?.name || ''}`.trim(),
        riferimento: numeroSped,
        importo: -Math.abs(costo),
        spedizioneId,
        createdBy: user!.id,
      })
    } catch (e) {
      console.error('Errore registrazione movimento spedizione:', e)
    }
  }

  // ── Blocco a monte: verifica il credito dei MASTER della catena (prezzo da listino
  //    ereditato). Se un master "credito_scalare" è a secco, tutta la catena è bloccata.
  //    Il proprietario del corriere non viene bloccato qui (costo API noto solo dopo). ──
  if (!isProprio) {
    const catenaCheck = await verificaCreditoCatena(supabase, {
      masterDirettoId: masterId,
      corriereOwnerId: corriereRecord.master_id,
      provincia: body.shipTo.state,
      packages,
      cap: body.shipTo.postalCode,
      paese: body.shipTo.country || 'IT',
      citta: body.shipTo.city,
      corriereNome: corriereRecord.nome_contratto,
      contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
    })
    if (!catenaCheck.ok) {
      // Nessuno vede credito/costo dei master SOPRA di sé: mostro il dettaglio SOLO se il
      // master a secco è il PROPRIO (utente.master_id). Clienti e livelli inferiori: generico.
      const proprio = utente?.ruolo !== 'cliente' && catenaCheck.masterInsufficiente === utente?.master_id
      const msg = proprio ? catenaCheck.errore : 'Credito insufficiente'
      return NextResponse.json({ error: msg }, { status: 402 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEDISCI.ONLINE
  // ═══════════════════════════════════════════════════════════════════════════
  if (corriereRecord.tipo === 'spedisci') {
    const baseUrl = `https://${cred.master_domain}/api/v2`

    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packages, shipFrom: body.shipFrom, shipTo: body.shipTo,
        notes: body.notes || '', insuranceValue: body.insuranceValue || 0,
        codValue: body.codValue || 0, accessoriServices: []
      }),
    })
    const rates = await ratesRes.json()
    if (!Array.isArray(rates) || !rates.length) return NextResponse.json({ error: 'Nessuna tariffa dal corriere' }, { status: 400 })
    // IMPORTANTE: sullo stesso account a valle possono esserci PIÙ corrieri (es. GLS + Poste).
    // Va scelta la tariffa del CONTRATTO di QUESTO corriere (codice_contratto), NON la prima:
    // altrimenti una spedizione "Poste Delivery Express D" poteva stampare GLS/SDA (rates[0]).
    const { trovaRateContratto } = await import('@/lib/spedisci')
    const rate = trovaRateContratto(rates, cred)
    if (!rate) return NextResponse.json({ error: 'Contratto non disponibile per questo corriere (verifica il codice contratto)' }, { status: 400 })

    const res = await fetch(`${baseUrl}/shipping/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrierCode: rate.carrierCode, contractCode: rate.contractCode,
        label_format: 'PDF', packages,
        // EMAIL SCHERMO: al provider va SEMPRE l'email di servizio (mai quelle vere di mitt/dest).
        shipFrom: { ...body.shipFrom, email: EMAIL_PER_CORRIERE }, shipTo: { ...body.shipTo, email: EMAIL_PER_CORRIERE },
        // Rif. Ordine in testa alle note così finisce sull'etichetta (canale trasmesso al corriere).
        notes: [body.rifOrdine ? `Rif. Ordine: ${body.rifOrdine}` : '', body.notes || ''].filter(Boolean).join(' — '),
        // content = descrizione merce inserita dall'utente → in etichetta (guardato: solo se compilato)
        ...(String(body.contenuto || '').trim() ? { content: String(body.contenuto).trim() } : {}),
        insuranceValue: body.insuranceValue || 0,
        codValue: body.codValue || 0, accessoriServices: []
      }),
    })

    const text = await res.text()
    let r: any
    try { r = JSON.parse(text) } catch { r = { error: text } }
    if (!res.ok || r.error) return NextResponse.json({ error: erroreCorrierePulito(r?.error || text) }, { status: 400 })

    const numero = r.trackingNumber
    const costoCliente = isProprio ? costoMaster : (parseFloat(body.totalPrice) || parseFloat(r.shipmentCost) || 0)
    const costoCorrente = parseFloat(r.shipmentCost) || 0

    let etichetteUrls: string[] = []
    if (Array.isArray(r.labels) && r.labels.length) {
      etichetteUrls = r.labels.map((l: any) => l.labelData ? `data:application/pdf;base64,${l.labelData}` : (l.url || '')).filter(Boolean)
    } else if (r.labelData) {
      etichetteUrls = packages.map(() => `data:application/pdf;base64,${r.labelData}`)
    }

    const colliDettaglio = (body.colliDettaglio || packages.map((p: any) => ({
      lunghezza: p.length, larghezza: p.width, altezza: p.height
    }))).map((c: any, i: number) => ({
      numero: i + 1,
      lunghezza: c.lunghezza || packages[i]?.length || null,
      larghezza: c.larghezza || packages[i]?.width || null,
      altezza: c.altezza || packages[i]?.height || null,
      peso: packages[i]?.weight || null,
      etichetta_url: etichetteUrls[i] || etichetteUrls[0] || null,
    }))

    // *** FIX: salviamo contractCode e carrierCode dentro raw_response per riusarli nei ritiri ***
    const { data: inserted, error: insertError } = await supabase.from('spedizioni').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id, numero,
      mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
      mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
      mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
      dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
      dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
      dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
      colli: packages.length, peso_reale: packages[0]?.weight || null,
      peso_volume: pesoVolCalc || null, peso_fatturato: pesoFattCalc || null,
      lunghezza: packages[0]?.length || null, larghezza: packages[0]?.width || null, altezza: packages[0]?.height || null,
      contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
      tracking_number: r.trackingNumber || null,
      etichetta_url: etichetteUrls[0] || (r.labelData ? `data:application/pdf;base64,${r.labelData}` : null),
      colli_dettaglio: colliDettaglio,
      raw_response: { ...r, _carrierCode: rate.carrierCode, _contractCode: rate.contractCode },
      stato: 'in_lavorazione',
      costo_spedizione: costoCorrente, costo_totale: costoCliente,
      servizi_accessori: serviziAccessori,
      note: body.notes || null, contenuto: body.contenuto || null,
      rif_ordine: body.rifOrdine || null, rif_destinatario: body.rifDestinatario || null,
    }).select('id').single()

    if (insertError) {
      // COMPENSAZIONE: annulla sul corriere per non lasciare spedizioni orfane.
      let annullata = false
      try {
        const shipId = (r as any).shipmentId || (r as any).id
        if (shipId) {
          const del = await fetch(`${baseUrl}/shipping/delete`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ shipment_ids: [shipId] }),
          })
          annullata = del.ok
        }
      } catch {}
      return NextResponse.json({
        error: annullata
          ? `Spedizione non registrata (errore DB) e annullata sul corriere. Riprova. Dettaglio: ${insertError.message}`
          : `Errore DB e impossibile annullare sul corriere (rif. ${numero}): contatta l'assistenza. ${insertError.message}`,
        numero, annullataSuCorriere: annullata,
      }, { status: 500 })
    }

    // Detrazione credito (movimento -costo cliente, oppure -listino corriere se spedizione propria)
    await addebitaCredito(inserted?.id || null, numero, costoCliente)

    // Addebito a cascata sui master della catena. Vale ANCHE per la spedizione propria di
    // un master: costruisciCatena risale dal master fino al proprietario reale del contratto
    // e addebita ogni livello col suo prezzo (il proprietario paga il costo reale API).
    await addebitaCatena(supabase, {
      masterDirettoId: masterId, corriereOwnerId: corriereRecord.master_id,
      costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages,
      cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
      corriereNome: corriereRecord.nome_contratto,
      contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
      numero, destNome: body.shipTo?.name || '', spedizioneId: inserted?.id || null, createdBy: user!.id,
    })

      // EMAIL BRAND MoovExpress a mittente e destinatario (in background, best-effort):
      // le email vere restano nostre — al provider e' andata solo l'email schermo.
      after(async () => {
        try {
          const { inviaEmailSpedizioneCreata } = await import('@/lib/email')
          let notificaDest = true
          if (clienteId) {
            const { createAdminSupabase } = await import('@/lib/supabase-admin')
            const { data: cli } = await createAdminSupabase().from('clienti').select('impostazioni').eq('id', clienteId).maybeSingle()
            notificaDest = (cli?.impostazioni as any)?.notifica_email_dest !== false
          }
          await inviaEmailSpedizioneCreata({
            mittEmail: body.shipFrom?.email, destEmail: body.shipTo?.email,
            mittNome: body.shipFrom?.name, destNome: body.shipTo?.name, destCitta: body.shipTo?.city,
            numero: numero, corriere: corriereRecord.nome_contratto, notificaDest,
          })
        } catch { /* la spedizione e' gia' creata: l'email non blocca nulla */ }
      })

    return NextResponse.json({ numero, tracking: r.trackingNumber, costo: r.shipmentCost, spedizioneId: inserted?.id || null })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEDIAMOPRO
  // ═══════════════════════════════════════════════════════════════════════════
  if (corriereRecord.tipo === 'spediamopro') {
    // Telefono DESTINATARIO obbligatorio: SpediamoPro lo esige (serve al corriere per la consegna) e
    // senza un numero valido rispondeva col tecnico "consignee.phone should be of type string". Meglio
    // bloccare subito con un messaggio chiaro, così il cliente lo inserisce corretto.
    if (!telValidoSp(body.shipTo?.phone)) {
      return NextResponse.json({ error: 'Telefono destinatario obbligatorio e non valido: inserisci un numero corretto (solo cifre, 6–15). Il corriere lo richiede per la consegna.' }, { status: 400 })
    }
    try {
      // SpediamoPro valida telefono ed email: telefono solo cifre 6-15 (via spazi/trattini/+),
      // email formato valido. Se non validi vengono OMESSI (altrimenti la creazione fallisce).
      const telSp = (v: any): string | undefined => { const d = String(v || '').replace(/[^0-9]/g, ''); return (d.length >= 6 && d.length <= 15) ? d : undefined }
      const emailSp = (v: any): string | undefined => { const e = String(v || '').trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.substring(0, 50) : undefined }
      const sender = {
        name: body.shipFrom.name?.substring(0, 35),
        address: body.shipFrom.street1?.substring(0, 35),
        postalCode: body.shipFrom.postalCode,
        city: body.shipFrom.city?.substring(0, 35),
        province: body.shipFrom.state?.substring(0, 2).toUpperCase(),
        country: 'IT',
        phone: telSp(body.shipFrom.phone),
        // SpediamoPro (accept) ESIGE l'email del mittente come stringa: se l'anagrafica non ne ha
        // una valida, usiamo un indirizzo di servizio così la creazione non fallisce (prima dava
        // "sender.email should be of type string").
        email: emailSp(body.shipFrom.email) || 'noreply@moovexpress.com',
      }
      const consignee: any = {
        name: body.shipTo.name?.substring(0, 35),
        address: body.shipTo.street1?.substring(0, 35),
        postalCode: body.shipTo.postalCode,
        city: body.shipTo.city?.substring(0, 35),
        province: body.shipTo.state?.substring(0, 2).toUpperCase(),
        country: (body.shipTo.country || 'IT').toUpperCase(),
      }
      const telDest = telSp(body.shipTo.phone); if (telDest) consignee.phone = telDest
      // SpediamoPro (accept) ESIGE anche l'email del DESTINATARIO come stringa: senza, la creazione
      // fallisce con 422 ("consignee.email should be of type string"). Era la causa del "non spedisce"
      // su Poste standard quando il destinatario non aveva un'email valida. Fallback come il mittente.
      consignee.email = emailSp(body.shipTo.email) || 'noreply@moovexpress.com'

      // MULTICOLLO: un parcel per OGNI collo (prima si inviava solo il primo -> 1 sola etichetta)
      // NB: SpediamoPro non supporta una descrizione merce a testo libero sul collo (verificato via API):
      // il contenuto inserito dall'utente non può comparire in etichetta, dove resta "campionatura generica".
      // Il riferimento libero (Rif. Ordine) viaggia invece in externalReference (vedi sotto).
      const parcels = packages.map((p: any) => ({
        weight: kgToGrams(parseFloat(p?.weight) || 1),
        length: cmToMm(p?.length || 10), width: cmToMm(p?.width || 10), height: cmToMm(p?.height || 10),
      }))
      const cashOnDeliveryAmount = body.codValue ? euroToCents(body.codValue) : undefined
      const insuredAmount = body.insuranceValue ? euroToCents(body.insuranceValue) : undefined
      // BRT ha DUE service per lo STESSO contratto (entrambi BRTEXP): quale sia disponibile
      // dipende da PESO/MISURE e numero colli (es. mono pesante o 3+ colli → service_id_multicollo;
      // mono leggero / 1-2 colli → service_id). Non essendo prevedibile a priori, quando il contratto
      // ha un secondo service li passo SEMPRE ENTRAMBI e SpediamoPro sceglie il tier applicabile.
      // (Prima: mono usava solo service_id → col collo pesante tornava vuoto e falliva.)
      const serviceId = cred.service_id_multicollo
        ? [cred.service_id, cred.service_id_multicollo].filter(Boolean).join(',')
        : (cred.service_id || null)

      const quotation = await spediamoproGetQuotation(cred.authcode, serviceId, {
        parcels, sender, consignee, cashOnDeliveryAmount, insuredAmount
      })

      // NB: nessun blocco "vendita sotto costo" basato sul confronto costo-live vs prezzo listino:
      // dava troppi falsi positivi (bloccava destinazioni legittime dove il listino è più basso del
      // costo live). Il controllo sulle destinazioni disagiate è ora PER-ZONA (zone disagiate), non
      // per confronto di prezzo.

      // VERIFICATO via API su Poste Delivery Business (SpediamoPro):
      //  - "Rif." in etichetta = codice interno del corriere, NON impostabile;
      //  - "CONTENUTO" = categoria del parcel (type), non testo libero;
      //  - "NOTE:" (consigneeNote) è l'UNICO campo libero stampato, MA accetta max ~20 caratteri:
      //    oltre, il create fallisce con 422 "The shipment contains invalid data.".
      // Quindi in NOTE mettiamo SOLO un riferimento breve (l'ID ordine, o la nota), troncato a 20.
      const externalRef = (body.rifOrdine ? String(body.rifOrdine) : (body.notes ? String(body.notes) : '')).substring(0, 64) || undefined
      const noteEtichetta = (body.rifOrdine ? String(body.rifOrdine) : (body.notes ? String(body.notes) : '')).trim().substring(0, 20) || undefined

      const shipment = await spediamoproCreateShipment(cred.authcode, {
        parcels, sender, consignee, quotation, cashOnDeliveryAmount, insuredAmount,
        externalReference: externalRef,
        notes: noteEtichetta,
      })

      // ── Tracking + etichetta OTTIMIZZATI: prima la risposta all'utente è restata bloccata
      //    fino a ~30s (waitForTracking 10×2s + getLabel 5×2s). Ora facciamo solo un tentativo
      //    BREVE in linea (caso comune: già pronti) e il COMPLETAMENTO con i retry pieni avviene
      //    in background dopo la risposta (after) — nessuna funzione rimossa. ──
      let trackingReale = shipment.trackingCode
      if (!trackingReale) {
        // attesa breve (il polling completo lo fa il background qui sotto)
        trackingReale = await spediamoproWaitForTracking(cred.authcode, shipment.id, 3, 1500)
      }
      const numeroFinale = trackingReale || shipment.code || `SP-${shipment.id}`

      let etichettaUrl: string | null = null
      try {
        // un solo tentativo veloce: spesso l'etichetta mono-collo è già pronta
        const labelBuffer = await spediamoproGetLabel(cred.authcode, shipment.id, 1, 0)
        // Normalizzo: PDF/GIF/PNG invariati; ZIP multicollo → PDF unico multipagina (un collo per pagina).
        const { buffer, mime } = await normalizzaEtichetta(labelBuffer)
        etichettaUrl = `data:${mime};base64,${buffer.toString('base64')}`
      } catch {
        // Non ancora pronta (tipico del multicollo): la completa il background + riscarica on-demand.
      }

      const costoCorrente = centsToEuro(shipment.totalPrice)
      const costoCliente = isProprio ? costoMaster : (parseFloat(body.totalPrice) || costoCorrente)

      const { data: inserted, error: insertError } = await supabase.from('spedizioni').insert({
        master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id,
        numero: numeroFinale,
        mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
        mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
        mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
        dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
        dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
        dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
        colli: packages.length, peso_reale: (packages.reduce((s:number,p:any)=>s+(parseFloat(p?.weight)||0),0) || pesoReale),
        peso_volume: pesoVolCalc || null, peso_fatturato: pesoFattCalc || null,
        lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
        contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
        tracking_number: numeroFinale,
        etichetta_url: etichettaUrl,
        raw_response: { ...shipment, _quotation: quotation },
        stato: 'in_lavorazione',
        costo_spedizione: costoCorrente, costo_totale: costoCliente,
        servizi_accessori: serviziAccessori,
        note: body.notes || null, contenuto: body.contenuto || null,
        rif_ordine: body.rifOrdine || null, rif_destinatario: body.rifDestinatario || null,
      }).select('id').single()

      if (insertError) {
        // COMPENSAZIONE: se non riusciamo a registrarla noi, annulliamo la spedizione sul corriere
        // così non restano "orfane" (create sul corriere ma non su MoovExpress).
        const annullata = (await spediamoproCancelShipment(cred.authcode, shipment.id)).ok
        return NextResponse.json({
          error: annullata
            ? `Spedizione non registrata (errore DB) e annullata sul corriere. Riprova. Dettaglio: ${insertError.message}`
            : `Errore DB e impossibile annullare sul corriere (rif. ${numeroFinale}): contatta l'assistenza. ${insertError.message}`,
          numero: numeroFinale, annullataSuCorriere: annullata,
        }, { status: 500 })
      }

      // Detrazione credito (movimento -costo cliente, oppure -listino corriere se spedizione propria)
      await addebitaCredito(inserted?.id || null, numeroFinale, costoCliente)

      // Addebito a cascata sui master della catena (vale anche per la spedizione propria).
      await addebitaCatena(supabase, {
        masterDirettoId: masterId, corriereOwnerId: corriereRecord.master_id,
        costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages,
        cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
        corriereNome: corriereRecord.nome_contratto,
        contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
        numero: numeroFinale, destNome: body.shipTo?.name || '', spedizioneId: inserted?.id || null, createdBy: user!.id,
      })

      // ── COMPLETAMENTO IN BACKGROUND (dopo la risposta): stessi retry di prima
      //    (tracking definitivo + etichetta) senza far attendere l'utente. Se non gira,
      //    restano le reti di sicurezza: cron tracking + riscarica etichetta on-demand. ──
      if (inserted?.id) {
        const spedIdBg = inserted.id
        const trackingGiaOk = !!trackingReale
        const etichettaGiaOk = !!etichettaUrl
        const shipIdBg = shipment.id
        after(async () => {
          try {
            const upd: any = {}
            if (!trackingGiaOk) {
              const tr = await spediamoproWaitForTracking(cred.authcode, shipIdBg)
              if (tr && tr !== numeroFinale) { upd.numero = tr; upd.tracking_number = tr }
            }
            if (!etichettaGiaOk) {
              try {
                const lb = await spediamoproGetLabel(cred.authcode, shipIdBg)
                const norm = await normalizzaEtichetta(lb)
                upd.etichetta_url = `data:${norm.mime};base64,${norm.buffer.toString('base64')}`
              } catch { /* la prende la riscarica on-demand */ }
            }
            if (Object.keys(upd).length) await adminCrea.from('spedizioni').update(upd).eq('id', spedIdBg)
          } catch (e) { console.error('Completamento background spedizione SpediamoPro:', e) }
        })
      }

      // EMAIL BRAND MoovExpress a mittente e destinatario (in background, best-effort):
      // le email vere restano nostre — al provider e' andata solo l'email schermo.
      after(async () => {
        try {
          const { inviaEmailSpedizioneCreata } = await import('@/lib/email')
          let notificaDest = true
          if (clienteId) {
            const { createAdminSupabase } = await import('@/lib/supabase-admin')
            const { data: cli } = await createAdminSupabase().from('clienti').select('impostazioni').eq('id', clienteId).maybeSingle()
            notificaDest = (cli?.impostazioni as any)?.notifica_email_dest !== false
          }
          await inviaEmailSpedizioneCreata({
            mittEmail: body.shipFrom?.email, destEmail: body.shipTo?.email,
            mittNome: body.shipFrom?.name, destNome: body.shipTo?.name, destCitta: body.shipTo?.city,
            numero: numeroFinale, corriere: corriereRecord.nome_contratto, notificaDest,
          })
        } catch { /* la spedizione e' gia' creata: l'email non blocca nulla */ }
      })

      return NextResponse.json({
        numero: numeroFinale, tracking: numeroFinale, costo: costoCorrente.toFixed(2), spedizioneId: inserted?.id || null,
      })
    } catch (err: any) {
      console.error('SpediamoPro error:', err)
      return NextResponse.json({ error: erroreCorrierePulito(err?.message) }, { status: 400 })
    }
  }

  return NextResponse.json({ error: `Tipo corriere non supportato: ${corriereRecord.tipo}` }, { status: 400 })
}
