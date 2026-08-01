import { NextRequest, NextResponse, after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { verificaCreditoCatena, addebitaCatena } from '@/lib/cascata'
import { calcolaPrezzoCorriere, calcolaPrezzoCorriereDettaglio, calcolaSupplementiCliente, fattoreVolumeCliente, fattoreVolumeCorriere, calcolaPesoFatturato, calcolaPrezzoListino } from '@/lib/pricing'
import { isAgente, nomeAgente } from '@/lib/agente'
import { statoPiano, messaggioBlocco } from '@/lib/limite-piano'
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
// Il sanificatore dei messaggi del corriere ora sta in lib/errore-corriere.ts: lo usano anche
// l'API pubblica e la conferma distinte, che prima rimandavano il testo grezzo del provider.
import { erroreCorrierePulito } from '@/lib/errore-corriere'
import { motivoLimiteCollo } from '@/lib/limiti-collo'


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

  // Il blocco del credito e' piu' in basso: serve il prezzo calcolato dal SERVER, che si puo'
  // ottenere solo dopo aver risolto il contratto e la zona di destinazione.

  const masterId = isProprio ? utente!.master_id : cliente.master_id

  let corriereRecord: any = null

  // Il corriere puo' appartenere a un master ANTENATO nella catena (contratti condivisi a discesa).
  // RLS: lettura via admin; autorizzazione = check catena qui sotto.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminCrea = createAdminSupabase()

  // NIENTE BLOCCO DELLE SPEDIZIONI. Qui c'era il controllo del piano, che fermava la spedizione
  // quando il master della catena era oltre il limite o non in regola col canone. Ma fermare una
  // spedizione significa fermare il CLIENTE, che non c'entra: ha pagato il suo master e il suo
  // pacco deve partire. Chi non e' in regola viene chiuso fuori dal PROPRIO portale (CongelatoGate
  // e middleware) — non gli si spegne la rete, e i movimenti continuano a girare nella sua lista.

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
    // adminCrea, non il client dell'utente: le credenziali del contratto non devono essere
    // leggibili con il token di chi chiama (vedi la revoca sulla colonna `credenziali`).
    // Il perimetro resta quello del listino assegnato al cliente.
    const { data: fascia } = await adminCrea
      .from('listini_clienti_fasce')
      .select('corrieri(id,tipo,credenziali,nome_contratto,attivo,master_id)')
      .eq('listino_id', cliente.listino_cliente_id)
      .limit(1)
      .single()
    corriereRecord = (fascia as any)?.corrieri
  }

  if (!corriereRecord) {
    const { data: c } = await adminCrea
      .from('corrieri').select('id,tipo,credenziali,nome_contratto,attivo,master_id,settings,multicollo')
      .eq('master_id', masterId).eq('tipo', 'spedisci')
      .limit(1)
      .single()
    corriereRecord = c
  }

  if (!corriereRecord) return NextResponse.json({ error: 'Nessun corriere configurato' }, { status: 400 })

  if (corriereRecord.attivo === false) return NextResponse.json({ error: 'Corriere in pausa: spedizione non consentita.' }, { status: 400 })

  // In pausa da un master SOPRA: la sospensione vale per tutta la catena sotto, altrimenti si
  // venderebbe un servizio che a monte non parte. Vale anche se il contratto risulta attivo qui.
  {
    const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
    const sospesi = await contrattiSospesiSopra((corriereRecord as any).master_id)
    if (sospesoDallaCatena((corriereRecord as any).nome_contratto, sospesi)) {
      return NextResponse.json({ error: 'Contratto momentaneamente sospeso: spedizione non consentita.' }, { status: 400 })
    }
  }

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
  // RITIRO richiesto insieme alla spedizione. Serve a due cose: ai contratti DVA, dove e' l'UNICO
  // momento in cui si puo' prenotare (il corriere non ha una chiamata per aggiungerlo dopo), e a
  // tutti gli altri per lasciare traccia sulla spedizione che il ritiro e' stato chiesto.
  const _vuoleRitiro = body.richiediRitiro === true && !!body.dataRitiro
  const _pomeriggio = String(body.orarioRitiro || '').toLowerCase().startsWith('pom')
  // *** Controllo misure massime del corriere (settings.misure_max) ***
  // *** Controllo multicollo ***
  if (packages.length > 1 && (corriereRecord as any)?.multicollo === false) {
    return NextResponse.json({ error: 'Il contratto non prevede la funzione multicollo' }, { status: 400 })
  }
  // STESSO METRO DEL PREVENTIVO. Qui i lati si confrontavano ASSE PER ASSE (lunghezza con
  // lunghezza, larghezza con larghezza), mentre il preventivo confronta i lati ORDINATI dal piu'
  // lungo al piu' corto — che e' il criterio giusto, perche' un collo si puo' girare. Risultato:
  // lo stesso identico collo veniva QUOTATO e poi RIFIUTATO al momento di comprarlo, con un
  // "Volume troppo alto" che arrivava dopo aver gia' mostrato il prezzo.
  // In piu' qui si guardava solo `misure_max`, ignorando gli scaglioni di peso, il numero massimo
  // di colli, il peso per collo e la somma dei lati: limiti che il preventivo applica eccome.
  // Ora entrambi passano da lib/limiti-collo.ts: una regola sola, stesso esito.
  const _pesoTotaleColli = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
  const _motivoLimite = motivoLimiteCollo((corriereRecord as any)?.settings, _pesoTotaleColli, packages)
  if (_motivoLimite) {
    return NextResponse.json({ error: `Collo non accettato da questo contratto: ${_motivoLimite}.` }, { status: 400 })
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

  // *** PREZZO AL CLIENTE CALCOLATO DAL SERVER ***
  // body.totalPrice arriva dal browser. Veniva usato TALE E QUALE come importo addebitato: bastava
  // modificarlo per pagare quello che si voleva, mentre la catena dei master veniva addebitata per
  // intero dal server (perdita secca per tutta la rete). Con totalPrice a 0 si saltava anche il
  // blocco del credito. Qui il prezzo viene ricalcolato dal listino del cliente, come fa gia'
  // l'API pubblica in app/api/v1/shipments.
  // Regola scelta: si addebita il MAGGIORE fra il calcolo del server e quanto dichiarato dal
  // browser. Cosi' l'abuso "pago meno" e' chiuso, mentre resta possibile un prezzo piu' alto
  // deciso legittimamente a monte (accessori, maggiorazioni del master): non si cambia in silenzio
  // la fatturazione di chi oggi addebita correttamente.
  let prezzoServerCliente = 0
  if (!isProprio && cliente?.listino_cliente_id) {
    const risPrezzo = await calcolaPrezzoListino(adminCrea, {
      listinoId: cliente.listino_cliente_id, corriereId: corriereRecord.id,
      provincia: body.shipTo.state, cap: body.shipTo.postalCode,
      paese: body.shipTo.country || 'IT', citta: body.shipTo.city, packages,
    })
    if (!risPrezzo) {
      return NextResponse.json({ error: 'Destinazione non coperta dal listino per questo contratto: spedizione non creabile.' }, { status: 400 })
    }
    const suppPrezzo = await calcolaSupplementiCliente(adminCrea, {
      listinoId: cliente.listino_cliente_id, corriereId: corriereRecord.id,
      contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
      valoreMerce: Number(body.valoreMerce || 0), nolo: risPrezzo.prezzo,
    })
    prezzoServerCliente = Math.round((risPrezzo.prezzo + suppPrezzo.contrassegno + suppPrezzo.assicurazione) * 100) / 100
    const dichiarato = parseFloat(body.totalPrice) || 0
    if (dichiarato > 0 && dichiarato < prezzoServerCliente - 0.01) {
      console.warn('[CREA][PREZZO] importo dichiarato inferiore al listino, uso il listino', {
        cliente: cliente?.ragione_sociale, dichiarato, listino: prezzoServerCliente,
      })
    }
  }

  // ── Blocco credito insufficiente ("credito a scalare"): vale per CLIENTE, SOTTO-MASTER e
  //    MASTER su spedizione propria. Il costo di riferimento e' quello del SERVER (prima si usava
  //    body.totalPrice: con 0 il blocco non scattava e si spediva a credito esaurito).
  //    Il ROOT master (senza padre) e' esente.
  {
    const costoPreventivo = Math.max(prezzoServerCliente, parseFloat(body.totalPrice) || 0)
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

  // ── PRENOTAZIONE DEL CREDITO (solo CLIENTE) ─────────────────────────────────────────────────
  // Il controllo qui sopra legge il saldo e poi passa la mano al corriere: fra i due momenti
  // passano secondi, e due richieste simultanee vedevano entrambe credito capiente e passavano
  // entrambe (caso reale: saldo 29,80, due addebiti da 26,00 -> -22,20).
  // Qui il credito viene MOSSO SUBITO, con la capienza verificata nella stessa istruzione
  // (blocco di riga): due prenotazioni simultanee non possono piu' passare entrambe. Se il credito
  // non basta si esce PRIMA di creare qualcosa dal corriere.
  // A fine rotta la prenotazione viene CONFERMATA sull'importo definitivo, oppure STORNATA se la
  // spedizione non nasce. Le prenotazioni eventualmente rimaste appese vengono liberate dal giro
  // automatico /api/spedizioni/prenotazioni-scadute.
  let prenotazioneRif: string | null = null
  if (!isProprio && !masterSub && clienteId && prezzoServerCliente > 0) {
    const rif = `PRE:${crypto.randomUUID()}`
    try {
      await registraMovimento(adminCrea, {
        masterId, clienteId, tipo: 'spedizione',
        descrizione: `Prenotazione ${String(body.shipTo?.name || '').slice(0, 40)}`.trim(),
        riferimento: rif, importo: -Math.abs(prezzoServerCliente),
        createdBy: user!.id, richiediCapienza: true,
      })
      prenotazioneRif = rif
    } catch (e: any) {
      if (String(e?.message || '').includes('CREDITO_INSUFFICIENTE')) {
        const { data: cAgg } = await adminCrea.from('clienti').select('credito').eq('id', clienteId).maybeSingle()
        return NextResponse.json({
          error: `Credito insufficiente: disponibili € ${Number((cAgg as any)?.credito || 0).toFixed(2)}, spedizione € ${prezzoServerCliente.toFixed(2)}. Ricarica il credito per spedire.`,
        }, { status: 402 })
      }
      console.error('[CREA][PRENOTAZIONE] fallita, si prosegue con l addebito a fine rotta:', e?.message)
    }
  }
  // Libera la prenotazione quando la spedizione NON nasce. Idempotente: se e' gia' stata
  // confermata non fa nulla.
  async function stornaPrenotazione() {
    if (!prenotazioneRif) return
    const rif = prenotazioneRif; prenotazioneRif = null
    try { await adminCrea.rpc('storna_prenotazione_spedizione', { p_riferimento: rif }) }
    catch (e: any) { console.error('[CREA][STORNO PRENOTAZIONE]', rif, e?.message) }
  }

  // Spedizione propria del master: prezzo dal listino corriere (server-side, non ci fidiamo del body).
  let costoMaster = 0
  if (isProprio) {
    costoMaster = (await calcolaPrezzoCorriere(adminCrea, {
      corriereId: corriereRecord.id, masterId,
      provincia: body.shipTo.state, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
      pesoReale, packages,
      contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
    })) ?? null as any

    // Nessun prezzo a listino per questa destinazione = non vendibile, punto. Prima si ripiegava
    // su body.totalPrice, cioe' sul numero mandato dal browser: la spedizione partiva lo stesso e
    // veniva addebitata a una cifra che non usciva da nessun listino. Su una destinazione che il
    // corriere fa pagare di piu' (periferica, disagiata) e' una perdita secca a ogni collo.
    if (costoMaster === null) {
      return NextResponse.json({ error: 'Nessun prezzo a listino per questa destinazione con questo contratto: aggiungi la fascia della zona al listino o scegli un altro corriere.' }, { status: 400 })
    }
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
    // Se il credito e' stato PRENOTATO a inizio rotta, qui la prenotazione va CONFERMATA
    // sull'importo definitivo: non si crea un secondo movimento, si chiude quello esistente
    // agganciandolo alla spedizione. La conferma non verifica la capienza (il pacco ormai esiste,
    // l'importo e' dovuto) ed e' innocua se ripetuta.
    if (prenotazioneRif) {
      const rif = prenotazioneRif; prenotazioneRif = null
      try {
        const { error } = await adminCrea.rpc('conferma_prenotazione_spedizione', {
          p_riferimento: rif,
          p_spedizione_id: spedizioneId,
          p_descrizione: `${numeroSped} - ${body.shipTo?.name || ''}`.trim(),
          p_importo_finale: Math.abs(costo),
          p_riferimento_finale: numeroSped,
        })
        if (error) throw new Error(error.message)
        return
      } catch (e: any) {
        // La conferma non e' riuscita: la prenotazione resta appesa e verra' liberata dal giro
        // automatico. Si prosegue con l'addebito normale qui sotto, per non lasciare la
        // spedizione senza movimento.
        console.error('[CREA][CONFERMA PRENOTAZIONE] fallita:', rif, e?.message)
      }
    }
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
    // adminCrea: la catena legge i listini d'acquisto dei master SOPRA, che col token di chi
  // chiama non sono (e non devono essere) leggibili. Con il client dell'utente questa verifica
  // vedeva solo una parte della catena.
  const catenaCheck = await verificaCreditoCatena(adminCrea, {
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
      // DUE COSE DIVERSE, NON UNA. `verificaCreditoCatena` fallisce sia quando un master della
      // catena e' davvero a secco, sia quando la catena non e' configurata (manca il listino a un
      // livello, manca la tariffa per quella zona). Prima si rispondeva sempre "Credito
      // insufficiente" con 402: un problema di configurazione arrivava al cliente travestito da
      // problema di soldi, e lui ricaricava il credito senza che cambiasse nulla.
      // `masterInsufficiente` e' valorizzato SOLO nel caso credito: e' quello che distingue.
      const perCredito = !!catenaCheck.masterInsufficiente
      if (!perCredito) {
        console.error('[CREA][CATENA] configurazione incompleta:', catenaCheck.errore)
        await stornaPrenotazione()
        return NextResponse.json({
          error: 'Questo contratto non è configurato correttamente su un livello superiore della rete: non è possibile spedirci. Segnalalo all\'assistenza.',
        }, { status: 400 })
      }
      // Nessuno vede credito/costo dei master SOPRA di sé: mostro il dettaglio SOLO se il
      // master a secco è il PROPRIO (utente.master_id). Clienti e livelli inferiori: generico.
      const proprio = utente?.ruolo !== 'cliente' && catenaCheck.masterInsufficiente === utente?.master_id
      const msg = proprio ? catenaCheck.errore : 'Credito insufficiente'
      { await stornaPrenotazione(); return NextResponse.json({ error: msg }, { status: 402 }) }
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
    if (!Array.isArray(rates) || !rates.length) { await stornaPrenotazione(); return NextResponse.json({ error: 'Nessuna tariffa dal corriere' }, { status: 400 }) }
    // IMPORTANTE: sullo stesso account a valle possono esserci PIÙ corrieri (es. GLS + Poste).
    // Va scelta la tariffa del CONTRATTO di QUESTO corriere (codice_contratto), NON la prima:
    // altrimenti una spedizione "Poste Delivery Express D" poteva stampare GLS/SDA (rates[0]).
    const { trovaRateContratto } = await import('@/lib/spedisci')
    const rate = trovaRateContratto(rates, cred)
    if (!rate) {
      // Perche' e' finita cosi' va scritto nei log, altrimenti resta un mistero: o il pannello
      // espone piu' tariffe dello stesso vettore e il codice contratto salvato non le distingue,
      // oppure quel codice non e' un identificativo stabile (vedi codiceContrattoCifrato).
      const { codiceContrattoCifrato } = await import('@/lib/spedisci')
      console.error('[CREA][CONTRATTO] nessuna tariffa riconosciuta', {
        contratto: corriereRecord.nome_contratto,
        tariffe_dal_pannello: Array.isArray(rates) ? rates.length : 0,
        codice_salvato_cifrato: codiceContrattoCifrato(cred?.codice_contratto),
      })
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Contratto non disponibile per questa spedizione: il codice contratto configurato non corrisponde a nessuna tariffa. Segnalalo all\'assistenza.' }, { status: 400 })
    }

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
    if (!res.ok || r.error) { await stornaPrenotazione(); return NextResponse.json({ error: erroreCorrierePulito(r?.error || text) }, { status: 400 }) }

    const numero = r.trackingNumber
    // L'importo ADDEBITATO deve essere quello calcolato dal SERVER. Il controllo del credito piu'
    // sopra usava gia' il prezzo server, ma qui si addebitava body.totalPrice: bastava abbassarlo
    // nella richiesta per pagare meno, mentre la catena dei master veniva addebitata per intero.
    // Si tiene il MAGGIORE fra server e dichiarato, come nel controllo, per non alterare i casi in
    // cui a monte viene applicato legittimamente un prezzo piu' alto.
    const dichiaratoCli = parseFloat(body.totalPrice) || parseFloat(r.shipmentCost) || 0
    const costoCliente = isProprio ? costoMaster : Math.max(prezzoServerCliente, dichiaratoCli)
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
      // Sul MONOCOLLO l'etichetta del collo e' identica a quella della spedizione: si lascia vuota
      // e chi stampa usa etichetta_url. Sul MULTICOLLO invece serve, perche' la stampa massiva
      // scorre i colli uno per uno (app/api/spedizioni/etichette-bulk/route.ts:49-54).
      etichetta_url: packages.length > 1 ? (etichetteUrls[i] || etichetteUrls[0] || null) : null,
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
      // Il PDF NON si salva anche qui: e' gia' in etichetta_url, byte per byte identico
      // (verificato su 300 spedizioni). Tenerne una copia dentro raw_response costava ~30 kB a
      // spedizione, cioe' centinaia di MB, senza che nessuno la usasse davvero: i due percorsi di
      // download leggono etichetta_url e questa resta solo come rete per le spedizioni vecchie.
      raw_response: { ...r, labelData: undefined, labels: undefined, _carrierCode: rate.carrierCode, _contractCode: rate.contractCode },
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
      // Il testo del database (tabella, colonna, vincolo) resta nei log, non va all'utente.
      console.error('[CREA][INSERT]', numero, insertError.message)
      return NextResponse.json({
        error: annullata
          ? 'Spedizione non registrata e annullata sul corriere: riprova.'
          : `Spedizione non registrata e non annullabile sul corriere (rif. ${numero}): contatta l'assistenza indicando il riferimento.`,
        numero, annullataSuCorriere: annullata,
      }, { status: 500 })
    }

    // Detrazione credito (movimento -costo cliente, oppure -listino corriere se spedizione propria)
    await addebitaCredito(inserted?.id || null, numero, costoCliente)

    // Addebito a cascata sui master della catena. Vale ANCHE per la spedizione propria di
    // un master: costruisciCatena risale dal master fino al proprietario reale del contratto
    // e addebita ogni livello col suo prezzo (il proprietario paga il costo reale API).
    await addebitaCatena(adminCrea, {
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
      { await stornaPrenotazione(); return NextResponse.json({ error: 'Telefono destinatario obbligatorio e non valido: inserisci un numero corretto (solo cifre, 6–15). Il corriere lo richiede per la consegna.' }, { status: 400 }) }
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
      // Come nel ramo gemello: si addebita il prezzo del SERVER, non quello dichiarato dal browser.
      const dichiaratoCli = parseFloat(body.totalPrice) || costoCorrente
      const costoCliente = isProprio ? costoMaster : Math.max(prezzoServerCliente, dichiaratoCli)

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
        // Il ritiro e' stato prenotato insieme all'ordine qui sopra: va segnato sulla spedizione,
        // altrimenti in scheda risulterebbe "nessun ritiro" pur essendo stato chiesto al corriere.
        richiedi_ritiro: _vuoleRitiro || false,
        data_ritiro: _vuoleRitiro ? String(body.dataRitiro) : null,
        intervallo_ritiro: _vuoleRitiro ? (_pomeriggio ? '14:00-18:00' : '09:00-13:00') : null,
        note: body.notes || null, contenuto: body.contenuto || null,
        rif_ordine: body.rifOrdine || null, rif_destinatario: body.rifDestinatario || null,
      }).select('id').single()

      if (insertError) {
        // COMPENSAZIONE: se non riusciamo a registrarla noi, annulliamo la spedizione sul corriere
        // così non restano "orfane" (create sul corriere ma non su MoovExpress).
        const annullata = (await spediamoproCancelShipment(cred.authcode, shipment.id)).ok
        console.error('[CREA][INSERT]', numeroFinale, insertError.message)
        return NextResponse.json({
          error: annullata
            ? 'Spedizione non registrata e annullata sul corriere: riprova.'
            : `Spedizione non registrata e non annullabile sul corriere (rif. ${numeroFinale}): contatta l'assistenza indicando il riferimento.`,
          numero: numeroFinale, annullataSuCorriere: annullata,
        }, { status: 500 })
      }

      // Detrazione credito (movimento -costo cliente, oppure -listino corriere se spedizione propria)
      await addebitaCredito(inserted?.id || null, numeroFinale, costoCliente)

      // Addebito a cascata sui master della catena (vale anche per la spedizione propria).
      await addebitaCatena(adminCrea, {
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
      { await stornaPrenotazione(); return NextResponse.json({ error: erroreCorrierePulito(err?.message) }, { status: 400 }) }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EASYPARCEL (contratti DVA / DVA Last Minute)
  //
  // Tre passi obbligati — preventivo, ordine, lettera di vettura — e una differenza che cambia
  // il modo di scrivere questo ramo: DOPO L'ORDINE NON C'E' ANNULLO. Gli altri due provider, se
  // l'inserimento a database fallisce, cancellano la spedizione dal corriere e nessuno paga nulla.
  // Qui quella rete non esiste: superato l'ordine, il pacco e' comprato. Percio' tutto cio' che
  // puo' essere verificato viene verificato PRIMA, e dopo l'ordine non si esce mai per errore.
  // ═══════════════════════════════════════════════════════════════════════════
  if (corriereRecord.tipo === 'easyparcel') {
    const {
      easyparcelQuotation, easyparcelOrder, easyparcelWaybill,
      trovaOffertaVettore, erroreEasyparcelPulito, ErroreEasyparcel,
    } = await import('@/lib/easyparcel')

    const apikey = String(cred?.apikey || '')
    const vettore = String(cred?.vettore || '')
    if (!apikey || !vettore) {
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Contratto non configurato correttamente. Contatta l\'assistenza.' }, { status: 400 })
    }

    // CHIAVE DI PROVA (credenziali.ambiente = 'demo'): l'ordine viene accettato e restituisce
    // numero ed etichetta, ma NESSUN PACCO ESISTE DAVVERO. Venderlo a un cliente significherebbe
    // incassare per una spedizione che non partira' mai — e ce ne accorgeremmo dai reclami.
    // Il proprietario del contratto puo' provarlo sulle proprie spedizioni; a nessun altro.
    // Va tolto sostituendo la chiave con quella di produzione e mettendo ambiente = 'produzione'.
    if (String(cred?.ambiente || '').toLowerCase() === 'demo' && !isProprio) {
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Questo contratto è ancora in configurazione e non può essere usato per spedizioni reali.' }, { status: 400 })
    }

    // LIMITI FISICI DEL CONTRATTO, controllati QUI e non solo nel preventivo. Ogni corriere di
    // questo provider dichiara i suoi (numero colli, lato massimo, somma dei lati, peso per collo)
    // e li rifiuta a valle. Con un corriere che non permette l'annullo, accorgersene dopo l'acquisto
    // significa aver comprato una spedizione che non partira' e che non si puo' disdire. Il controllo
    // del preventivo non basta: alla creazione si arriva anche con una quotazione vecchia o dalla
    // spedizione propria del master, che quel preventivo non attraversa.
    {
      const { motivoLimiteCollo } = await import('@/lib/limiti-collo')
      const motivo = motivoLimiteCollo((corriereRecord as any)?.settings, pesoReale, packages)
      if (motivo) {
        await stornaPrenotazione()
        return NextResponse.json({ error: `Spedizione non accettata da questo corriere: ${motivo}. Correggi i colli o scegli un altro contratto.` }, { status: 400 })
      }
    }

    // Il provider ESIGE cellulare ed email di mittente E destinatario (verificato: senza, risponde
    // "Campo 'mittente->cellulare' mancante"). Il controllo va fatto adesso: scoprirlo dopo l'ordine
    // sarebbe irreparabile. L'email vera non gli arriva mai — va quella di servizio, come agli altri.
    const cell = (v: any): string => String(v || '').replace(/[^0-9]/g, '')
    const cellMitt = cell(body.shipFrom?.phone)
    const cellDest = cell(body.shipTo?.phone)
    if (cellMitt.length < 6) {
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Telefono del mittente obbligatorio per questo corriere: inserisci un numero valido (solo cifre) e riprova.' }, { status: 400 })
    }
    if (cellDest.length < 6) {
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Telefono del destinatario obbligatorio per questo corriere: serve al corriere per la consegna.' }, { status: 400 })
    }

    try {
      // ── 1) PREVENTIVO: serve solo a ottenere il codice offerta, non a fare il prezzo
      //    (quello resta il nostro listino, come per ogni altro contratto). ──
      const offerte = await easyparcelQuotation(apikey, {
        colli: packages.map((p: any) => ({
          peso: parseFloat(p?.weight) || 1,
          larghezza: parseFloat(p?.width) || 10,
          profondita: parseFloat(p?.length) || 10,
          altezza: parseFloat(p?.height) || 10,
        })),
        mittente: { cap: body.shipFrom.postalCode, localita: body.shipFrom.city, provincia: body.shipFrom.state, nazione: 'IT' },
        destinatario: { cap: body.shipTo.postalCode, localita: body.shipTo.city, provincia: body.shipTo.state, nazione: (body.shipTo.country || 'IT').toUpperCase() },
        contenuto: body.contenuto,
        contrassegno: Number(body.codValue || 0),
        assicurazione: Number(body.insuranceValue || 0),
      })
      // Sulla stessa chiave rispondono TUTTI i vettori agganciati (verificato: 19 offerte in una
      // sola risposta). Si prende quello del contratto venduto, mai il primo della lista: sarebbe
      // come stampare un corriere diverso da quello che il cliente ha scelto e pagato.
      // Anche il SERVIZIO, non solo il vettore: lo stesso codice corriere torna piu' volte con
      // livelli di servizio e prezzi diversi (vedi lib/easyparcel.ts).
      const offerta = trovaOffertaVettore(offerte, vettore, String(cred?.consegna || ''))
      if (!offerta) {
        await stornaPrenotazione()
        return NextResponse.json({ error: 'Nessuna tariffa disponibile per questa destinazione con il contratto scelto: prova un altro contratto.' }, { status: 400 })
      }
      // Servizi richiesti ma non attivabili su questa offerta: va fermato ORA. Ordinare comunque
      // significherebbe consegnare senza incassare il contrassegno.
      const opz = offerta.serviziopzionali || {}
      const codRichiesto = Number(body.codValue || 0) > 0
      const assRichiesta = Number(body.insuranceValue || 0) > 0
      if (codRichiesto && String(opz?.contrassegno?.attivabile || 'N').toUpperCase() !== 'S') {
        await stornaPrenotazione()
        return NextResponse.json({ error: 'Contrassegno non disponibile su questo contratto per questa destinazione. Rimuovilo o scegli un altro contratto.' }, { status: 400 })
      }
      if (assRichiesta && String(opz?.assicurazione?.attivabile || 'N').toUpperCase() !== 'S') {
        await stornaPrenotazione()
        return NextResponse.json({ error: 'Assicurazione non disponibile su questo contratto per questa destinazione.' }, { status: 400 })
      }

      // ── 2) ORDINE — oltre questa riga il pacco e' comprato e non si torna indietro ──
      const rifBreve = String(body.rifOrdine || '').trim().slice(0, 40) || undefined
      // RITIRO: su questi contratti si prenota SOLO qui — il corriere non ha una chiamata per
      // aggiungerlo dopo, e infatti /api/ritiri/crea lo rifiuta di proposito.
      const ordine = await easyparcelOrder(apikey, {
        codiceOfferta: String(offerta.codice_offerta),
        ...(_vuoleRitiro ? { ritiro: {
          dal: String(body.dataRitiro),
          dalleMattina: _pomeriggio ? '14:00' : '09:00',
          alleMattina: _pomeriggio ? '18:00' : '13:00',
          dallePomeriggio: '14:00',
          allePomeriggio: '18:00',
        } } : {}),
        mittente: {
          nominativo: body.shipFrom.name, indirizzo: body.shipFrom.street1,
          email: EMAIL_PER_CORRIERE, cellulare: cellMitt, contatto: body.shipFrom.name,
        },
        destinatario: {
          nominativo: body.shipTo.name, indirizzo: body.shipTo.street1,
          email: EMAIL_PER_CORRIERE, cellulare: cellDest, contatto: body.shipTo.name,
        },
        note: body.notes || undefined,
        custom: rifBreve,
        contrassegno: codRichiesto,
        assicurazione: assRichiesta,
      })

      // ── 3) LETTERA DI VETTURA: numero di tracking e PDF nascono solo qui.
      //    Se non e' pronta NON si esce con errore (l'ordine e' pagato): si salva lo stesso e la
      //    si recupera dopo, come gia' si fa col multicollo dell'altro provider. ──
      let ldv: string | null = null
      let _codiceRitiro: string | null = null
      let etichettaUrl: string | null = null
      // Una etichetta PER OGNI COLLO: il provider le restituisce in single_waybills, ognuna col
      // proprio numero di lettera di vettura. Vanno tenute separate e assegnate collo per collo —
      // ripetere la prima su tutti significherebbe far viaggiare tre colli con la stessa etichetta.
      let etichettePerCollo: string[] = []
      try {
        const w = await easyparcelWaybill(apikey, ordine.idOrdine, _vuoleRitiro ? 3 : 2, 1500, _vuoleRitiro)
        ldv = w.numero || null
        // Il codice di prenotazione del ritiro arriva QUI, non con l'ordine: e' l'unico posto in cui
        // il corriere lo comunica. Senza salvarlo, il ritiro risulta prenotato ma senza numero, e
        // chi deve consegnare il pacco al corriere non ha niente da esibire.
        _codiceRitiro = w.codiceRitiro || null
        etichettePerCollo = w.singole.map(s => `data:application/pdf;base64,${s.pdfBase64}`)
        // L'etichetta "della spedizione" e' l'unione di tutte: una pagina per collo, cosi' il
        // tasto Etichetta stampa tutto in una volta invece di un file per collo.
        const { unisciEtichette } = await import('@/lib/easyparcel')
        const b64 = (await unisciEtichette(w.singole.map(s => s.pdfBase64))) || w.pdfBase64
        if (b64) etichettaUrl = `data:application/pdf;base64,${b64}`
        // Meno etichette che colli: non si puo' annullare (l'ordine e' pagato) quindi la spedizione
        // va salvata comunque, ma deve restare traccia evidente. Con multicollo attivo questo e'
        // il segnale che qualcosa non torna e che i colli in eccesso viaggerebbero senza etichetta.
        if (packages.length > 1 && etichettePerCollo.length < packages.length) {
          console.error('[CREA][EASYPARCEL][ETICHETTE MANCANTI] ordine=%s colli=%d etichette=%d ldv=%s',
            ordine.idOrdine, packages.length, etichettePerCollo.length, ldv || '-')
        }
      } catch (e: any) {
        console.error('[CREA][EASYPARCEL] waybill non pronta, ordine', ordine.idOrdine, e?.message)
      }

      // Finche' la LDV non c'e', serve comunque un numero nostro: senza, la spedizione non e'
      // identificabile in elenco ne' agganciabile ai movimenti. Il completamento in background
      // lo sostituisce con la LDV vera appena disponibile.
      const numeroFinale = ldv || `TMP-${ordine.idOrdine}`
      const costoCorrente = ordine.importo
      const dichiaratoCli = parseFloat(body.totalPrice) || costoCorrente
      const costoCliente = isProprio ? costoMaster : Math.max(prezzoServerCliente, dichiaratoCli)

      const colliDettaglio = (body.colliDettaglio || packages.map((p: any) => ({
        lunghezza: p.length, larghezza: p.width, altezza: p.height,
      }))).map((c: any, i: number) => ({
        numero: i + 1,
        lunghezza: c.lunghezza || packages[i]?.length || null,
        larghezza: c.larghezza || packages[i]?.width || null,
        altezza: c.altezza || packages[i]?.height || null,
        peso: packages[i]?.weight || null,
        // L'etichetta DI QUESTO collo. Se il provider ne ha mandate meno dei colli si lascia null
        // invece di ripetere la prima: un'etichetta vuota si vede, una sbagliata no.
        etichetta_url: etichettePerCollo[i] || (packages.length === 1 ? etichettaUrl : null),
      }))

      const { data: inserted, error: insertError } = await supabase.from('spedizioni').insert({
        master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id,
        numero: numeroFinale,
        mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
        mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
        mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
        dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
        dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
        dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
        colli: packages.length, peso_reale: pesoReale,
        peso_volume: pesoVolCalc || null, peso_fatturato: pesoFattCalc || null,
        lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
        contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
        tracking_number: ldv,
        etichetta_url: etichettaUrl,
        colli_dettaglio: colliDettaglio,
        // _codiceOfferta e' il riferimento con cui si interroga il tracking (verificato: la ricerca
        // per LDV risponde "Spedizione non trovata", quella per codice offerta funziona).
        raw_response: { ...ordine, _codiceOfferta: String(offerta.codice_offerta), _vettore: vettore, _idOrdine: ordine.idOrdine, _codiceRitiro },
        stato: 'in_lavorazione',
        costo_spedizione: costoCorrente, costo_totale: costoCliente,
        servizi_accessori: serviziAccessori,
        richiedi_ritiro: _vuoleRitiro || false,
        data_ritiro: _vuoleRitiro ? String(body.dataRitiro) : null,
        intervallo_ritiro: _vuoleRitiro ? (_pomeriggio ? '14:00-18:00' : '09:00-13:00') : null,
        note: body.notes || null, contenuto: body.contenuto || null,
        rif_ordine: body.rifOrdine || null, rif_destinatario: body.rifDestinatario || null,
      }).select('id').single()

      if (insertError) {
        // Caso che con gli altri due provider si risolve annullando: QUI NON SI PUO'. La spedizione
        // esiste ed e' pagata. Non si addebita il cliente (di una spedizione che non risulta da
        // nessuna parte non deve pagare) e la prenotazione viene liberata dal giro automatico.
        // Si lascia una traccia completa nei log per ricostruirla a mano.
        console.error('[CREA][EASYPARCEL][ORDINE ORFANO] ordine=%s ldv=%s cliente=%s master=%s errore=%s',
          ordine.idOrdine, ldv || '-', clienteId || '-', masterId, insertError.message)
        return NextResponse.json({
          error: `Spedizione creata sul corriere (rif. ${numeroFinale}) ma non registrata a sistema, e questo corriere non consente l'annullo automatico. Contatta subito l'assistenza indicando il riferimento.`,
          numero: numeroFinale, annullataSuCorriere: false,
        }, { status: 500 })
      }

      await addebitaCredito(inserted?.id || null, numeroFinale, costoCliente)

      // Protetto apposta: da qui la spedizione esiste ed e' salvata. Se la cascata inciampasse,
      // l'eccezione finirebbe nel catch in fondo e l'utente si vedrebbe un "corriere non
      // disponibile" per una spedizione che invece e' stata creata regolarmente.
      try {
        await addebitaCatena(adminCrea, {
          masterDirettoId: masterId, corriereOwnerId: corriereRecord.master_id,
          costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages,
          cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
          corriereNome: corriereRecord.nome_contratto,
          contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
          numero: numeroFinale, destNome: body.shipTo?.name || '', spedizioneId: inserted?.id || null, createdBy: user!.id,
        })
      } catch (e) { console.error('[CREA][EASYPARCEL] cascata catena:', e) }

      // Recupero in background di cio' che non era ancora pronto (stesso schema dell'altro provider).
      // Il recupero in background serve anche quando la LDV c'e' ma manca il codice del ritiro:
      // il corriere lo assegna anche minuti dopo, e senza questo non lo prendeva piu' nessuno.
      if (inserted?.id && (!ldv || !etichettaUrl || (_vuoleRitiro && !_codiceRitiro))) {
        const spedIdBg = inserted.id
        const idOrdineBg = ordine.idOrdine
        const vuoleRitiroBg = _vuoleRitiro
        after(async () => {
          try {
            const { easyparcelWaybill: wb, unisciEtichette: unisci } = await import('@/lib/easyparcel')
            const w = await wb(apikey, idOrdineBg, 8, 4000, vuoleRitiroBg)
            const upd: any = {}
            if (w.numero) { upd.numero = w.numero; upd.tracking_number = w.numero }
            // Il codice di prenotazione del ritiro viaggia con la lettera di vettura: se non era
            // pronta al momento della creazione, questo e' l'unico momento in cui lo si puo'
            // ancora prendere. Senza salvarlo qui il ritiro resterebbe per sempre senza numero.
            if (w.codiceRitiro) {
              const codice = w.codiceRitiro
              // Si rilegge la riga adesso: nel frattempo la schermata ha chiamato /api/ritiri/crea,
              // che ha agganciato la spedizione alla riga Ritiri (ritiro_id). Quella riga e' nata
              // senza codice — qui la si completa.
              const { data: att } = await adminCrea.from('spedizioni')
                .select('raw_response,ritiro_id').eq('id', spedIdBg).maybeSingle()
              upd.raw_response = { ...((att?.raw_response as any) || {}), _codiceRitiro: w.codiceRitiro }
              if (att?.ritiro_id) {
                try {
                  await adminCrea.from('ritiri').update({ cod_ritiro: codice, tracking_ritiro: codice })
                    .eq('id', att.ritiro_id).is('cod_ritiro', null)
                } catch { }
              }
            }
            const b64 = (await unisci(w.singole.map(s => s.pdfBase64))) || w.pdfBase64
            if (b64) upd.etichetta_url = `data:application/pdf;base64,${b64}`
            // Anche qui le etichette vanno rimesse collo per collo, non solo quella unica.
            if (w.singole.length && Array.isArray(colliDettaglio) && colliDettaglio.length) {
              upd.colli_dettaglio = colliDettaglio.map((c: any, i: number) => ({
                ...c, etichetta_url: w.singole[i] ? `data:application/pdf;base64,${w.singole[i].pdfBase64}` : (c.etichetta_url || null),
              }))
            }
            if (Object.keys(upd).length) await adminCrea.from('spedizioni').update(upd).eq('id', spedIdBg)
          } catch (e) { console.error('[CREA][EASYPARCEL] completamento background:', e) }
        })
      }

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
        numero: numeroFinale, tracking: ldv, costo: costoCorrente.toFixed(2), spedizioneId: inserted?.id || null,
        // Il codice di prenotazione del ritiro va restituito subito: e' quello che l'utente deve
        // esibire al corriere. Se la lettera di vettura non era ancora pronta qui e' vuoto, e la
        // schermata lo richiede tra qualche secondo con /api/spedizioni/stato.
        codiceRitiro: _codiceRitiro,
        provvisorio: !ldv,
      })
    } catch (err: any) {
      // Si arriva qui SOLO da preventivo/ordine falliti: da li' in poi il ramo non lancia piu'.
      // Quindi lo storno della prenotazione e' sempre corretto — nessun pacco e' stato comprato.
      console.error('[CREA][EASYPARCEL]', err?.codice ?? '-', err?.message, err?.dettagli || '')
      await stornaPrenotazione()
      const msg = err instanceof ErroreEasyparcel ? erroreEasyparcelPulito(err) : erroreCorrierePulito(err?.message)
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUITO INTERNO — il corriere siamo noi
  //
  // Nessun provider da chiamare: il numero di lettera di vettura lo assegna il database (con un
  // contatore atomico, perche' due creazioni simultanee non devono poter ottenere lo stesso
  // numero) e l'etichetta la stampiamo noi, col logo del master. Tutto il resto — prezzo dal
  // listino, credito, cascata sulla rete, distinte, contrassegni — e' identico agli altri
  // contratti: e' esattamente il punto di farlo passare da qui invece che da un modulo a parte.
  // ═══════════════════════════════════════════════════════════════════════════
  if (corriereRecord.tipo === 'interno') {
    const { data: numeroInterno, error: errNum } = await adminCrea.rpc('prossimo_numero_interno', { p_master: corriereRecord.master_id })
    if (errNum || !numeroInterno) {
      console.error('[CREA][INTERNO] numerazione fallita', errNum?.message)
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Numerazione interna non disponibile: riprova o contatta l\'assistenza.' }, { status: 500 })
    }
    const numeroFinale = String(numeroInterno)

    // IL COSTO NON ARRIVA DAL BROWSER. Sugli altri contratti il costo reale lo dice il corriere;
    // qui il corriere siamo noi, quindi il costo e' il listino di chi manda — calcolato dal
    // server. Prima si ripiegava su body.totalPrice: bastava cambiare quel numero nel browser e
    // il detentore del circuito si vedeva addebitare sul credito la cifra scritta da chi spedisce.
    let costoInterno = costoMaster
    if (!isProprio) {
      costoInterno = (await calcolaPrezzoCorriere(adminCrea, {
        corriereId: corriereRecord.id, masterId,
        provincia: body.shipTo.state, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
        pesoReale, packages,
        contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
      })) ?? 0
    }
    const costoCorrente = costoInterno
    const costoCliente = isProprio ? costoMaster : Math.max(prezzoServerCliente, parseFloat(body.totalPrice) || 0)

    // Logo del master proprietario del contratto: e' la sua rete, e' il suo marchio sul pacco.
    let logoPng: Uint8Array | null = null
    let nomeMaster: string | null = null
    try {
      const { data: mLogo } = await adminCrea.from('masters').select('logo_url,nome').eq('id', corriereRecord.master_id).maybeSingle()
      nomeMaster = mLogo?.nome || null
      if (mLogo?.logo_url) {
        const r = await fetch(mLogo.logo_url)
        if (r.ok) logoPng = new Uint8Array(await r.arrayBuffer())
      }
    } catch { /* senza logo l'etichetta esce col nome scritto: non e' un motivo per non spedire */ }

    let etichettaUrl: string | null = null
    try {
      const { etichettaInterna } = await import('@/lib/etichetta-interna')
      const pdf = await etichettaInterna({
        numero: numeroFinale,
        mittente: { nome: body.shipFrom?.name, indirizzo: body.shipFrom?.street1, cap: body.shipFrom?.postalCode, citta: body.shipFrom?.city, provincia: body.shipFrom?.state, telefono: body.shipFrom?.phone },
        destinatario: { nome: body.shipTo?.name, indirizzo: body.shipTo?.street1, cap: body.shipTo?.postalCode, citta: body.shipTo?.city, provincia: body.shipTo?.state, telefono: body.shipTo?.phone },
        colli: packages.length, peso: pesoReale,
        contrassegno: Number(body.codValue || 0), note: body.notes || null,
        riferimento: body.rifOrdine || null, logoPng, nomeMaster,
      })
      etichettaUrl = `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`
    } catch (e: any) {
      // L'etichetta si puo' ristampare; la spedizione no. Meglio salvarla senza che perderla.
      console.error('[CREA][INTERNO] etichetta non generata', numeroFinale, e?.message)
    }

    const colliDettaglio = (body.colliDettaglio || packages.map((p: any) => ({
      lunghezza: p.length, larghezza: p.width, altezza: p.height,
    }))).map((c: any, i: number) => ({
      numero: i + 1,
      lunghezza: c.lunghezza || packages[i]?.length || null,
      larghezza: c.larghezza || packages[i]?.width || null,
      altezza: c.altezza || packages[i]?.height || null,
      peso: packages[i]?.weight || null,
      // Etichetta unica multipagina: una pagina per collo, gia' col "collo n di N" sopra.
      etichetta_url: null,
    }))

    const { data: inserted, error: insertError } = await supabase.from('spedizioni').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id,
      numero: numeroFinale,
      mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
      mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
      mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
      dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
      dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
      dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
      colli: packages.length, peso_reale: pesoReale,
      peso_volume: pesoVolCalc || null, peso_fatturato: pesoFattCalc || null,
      lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
      contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
      tracking_number: numeroFinale,
      etichetta_url: etichettaUrl,
      colli_dettaglio: colliDettaglio,
      raw_response: { _interno: true },
      stato: 'in_lavorazione',
      costo_spedizione: costoCorrente, costo_totale: costoCliente,
      servizi_accessori: serviziAccessori,
      richiedi_ritiro: _vuoleRitiro || false,
      data_ritiro: _vuoleRitiro ? String(body.dataRitiro) : null,
      intervallo_ritiro: _vuoleRitiro ? (_pomeriggio ? '14:00-18:00' : '09:00-13:00') : null,
      note: body.notes || null, contenuto: body.contenuto || null,
      rif_ordine: body.rifOrdine || null, rif_destinatario: body.rifDestinatario || null,
    }).select('id').single()

    if (insertError) {
      // Qui, a differenza dei provider, non c'e' niente da annullare fuori: la spedizione non e'
      // mai uscita da noi. Si libera la prenotazione e si riparte pulito.
      console.error('[CREA][INTERNO][INSERT]', numeroFinale, insertError.message)
      await stornaPrenotazione()
      return NextResponse.json({ error: 'Spedizione non registrata: riprova.' }, { status: 500 })
    }

    await addebitaCredito(inserted?.id || null, numeroFinale, costoCliente)
    try {
      await addebitaCatena(adminCrea, {
        masterDirettoId: masterId, corriereOwnerId: corriereRecord.master_id,
        costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages,
        cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', citta: body.shipTo.city,
        corriereNome: corriereRecord.nome_contratto,
        contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
        numero: numeroFinale, destNome: body.shipTo?.name || '', spedizioneId: inserted?.id || null, createdBy: user!.id,
      })
    } catch (e) { console.error('[CREA][INTERNO] cascata catena:', e) }

    after(async () => {
      try {
        const { inviaEmailSpedizioneCreata } = await import('@/lib/email')
        let notificaDest = true
        if (clienteId) {
          const { data: cli } = await adminCrea.from('clienti').select('impostazioni').eq('id', clienteId).maybeSingle()
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
      numero: numeroFinale, tracking: numeroFinale, costo: costoCorrente.toFixed(2),
      spedizioneId: inserted?.id || null,
    })
  }

  { await stornaPrenotazione(); return NextResponse.json({ error: `Tipo corriere non supportato: ${corriereRecord.tipo}` }, { status: 400 }) }
}
