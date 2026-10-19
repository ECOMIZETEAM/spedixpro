import { tokenAmazon, spapi, MARKETPLACE_IT, LimiteAmazon, AutorizzazioneAmazonRevocata, aggiornaCredenzialiAmazon, chiudiIntegrazioneAmazon } from '@/lib/amazon'
import { contaStatiSincronizzati } from '@/lib/shopifySync'
import { rangeGiorniISO } from '@/lib/ebaySync'
import { capofilaDiUnioni } from '@/lib/wooSync'
import { siglaProvincia, SIGLE_IT } from '@/lib/province-it'
import { CAP_PROVINCIA } from '@/lib/provincia-da-cap'

// ORDINI AMAZON (collegamento diretto) → ordini_ecommerce, come gli altri negozi.
//
// Orders API v2026-01-01 (searchOrders). La v0 (getOrders/getOrderItems/getOrderAddress) e'
// dismessa dal 28/01/2026 e smette di rispondere il 27/03/2027: non la usiamo. Con la v2026
// indirizzo e dati del compratore arrivano nella stessa risposta, se l'app ha il ruolo
// "Spedizione diretta al consumatore", senza Restricted Data Token; e gli articoli sono gia'
// dentro l'ordine.
//
// I DATI DEL COMPRATORE SOLO PER GLI ORDINI DA SPEDIRE. La Data Protection Policy di Amazon li
// consente per spedire, e per non oltre 30 giorni dalla consegna. Percio' nome, indirizzo, telefono
// ed email si scrivono SOLO per gli ordini Amazon ancora aperti (da spedire) e creati da meno di 30
// giorni; per un ordine spedito o annullato su Amazon si aggiorna soltanto lo stato della riga che
// c'e' gia'. Cosi' il conto dei 30 giorni di purge-pii, che parte dall'importazione, parte sempre
// prima della consegna.
//
// IL LIMITE E' IL TEMPO, NON I DATI. searchOrders concede una chiamata ogni ~3 minuti per
// venditore, dopo una raffica iniziale di 20 (da 100 ordini l'una). Percio':
//  - il giro automatico chiede solo gli ordini CAMBIATI dall'ultima volta (lastUpdatedAfter =
//    cursore salvato), che a ogni passaggio sono poche pagine;
//  - il primo giro di un account appena collegato prende gli ordini APERTI degli ultimi 7 giorni;
//  - se Amazon ferma la lettura a meta' (limite) o finisce il tempo, si salva il punto (il token
//    di pagina vale 24 ore) e il giro dopo riprende da li';
//  - un ordine che non si e' riusciti a salvare si rilegge da solo al giro dopo (da_riprovare),
//    perche' il cursore va avanti e quell'ordine Amazon non lo ridarebbe piu'.
// Il tasto "Sincronizza" della pagina legge invece gli ordini da spedire del periodo scelto (per
// DATA ORDINE, come per gli altri negozi); spediti e annullati li allinea il giro automatico.

const PERCORSO = '/orders/2026-01-01/orders'
const DATI = 'RECIPIENT,BUYER,FULFILLMENT,PROCEEDS,PAYMENT'
const STATI_TUTTI = 'UNSHIPPED,PARTIALLY_SHIPPED,SHIPPED,CANCELLED'
const STATI_APERTI = 'UNSHIPPED,PARTIALLY_SHIPPED'
// Amazon vuole il "...Before" almeno 2 minuti prima della richiesta: 3 per stare larghi.
const MARGINE_MS = 3 * 60 * 1000
const GIORNI_PRIMO_GIRO = 7
// Oltre questa eta' (data dell'ordine su Amazon) un ordine non riceve piu' dati personali: e' la
// soglia di purge-pii, e un ordine Amazon aperto da 30 giorni non si spedisce piu'.
const GIORNI_DATI = 30
// Il cron sincronizza piu' negozi nello stesso giro e ha un margine fisso per l'ultimo partito:
// il giro automatico si ferma prima del tasto in pagina, che ha la funzione tutta per se'.
const TEMPO_MAX_CRON_MS = 90000
const TEMPO_MAX_PAGINA_MS = 150000
// Ordini da rileggere uno per uno (getOrder, 0,5 al secondo): quanti per giro, e dopo quanti
// giri falliti si smette (e lo si scrive nell'errore dell'integrazione).
const RIPROVA_PER_GIRO = 20
const RIPROVA_MAX = 10

type Opzioni = { dal?: string | null; al?: string | null; incrementale?: boolean }
type Ripresa = { query: Record<string, string>; token: string; fine: string; scade: number }
type StatoSync = { cursore?: string; ripresa?: Ripresa; da_riprovare?: Record<string, number> }
type Esito = { letti: number; importati: number; spediti: number; daSpedire: number; annullati: number; completa: boolean; avviso: string | null }

const istante = (s?: string | null) => (s ? Date.parse(s) : NaN)

export async function sincronizzaOrdiniAmazon(db: any, integr: any, opz: Opzioni = {}): Promise<Esito> {
  let token: string
  try {
    token = await tokenAmazon(db, integr)
  } catch (e) {
    // L'autorizzazione non torna da sola: integrazione chiusa e dati cancellati (lib/amazon).
    if (e instanceof AutorizzazioneAmazonRevocata) await chiudiIntegrazioneAmazon(db, integr, e.message)
    throw e
  }

  const sync = ({ ...((integr.credenziali || {}).sync || {}) }) as StatoSync
  const ora = Date.now()
  const prima = new Date(ora - MARGINE_MS).toISOString()

  // Quale lettura: il periodo chiesto dalla pagina, la ripresa di una paginazione interrotta,
  // gli aggiornamenti dal cursore, oppure il primo giro di un account appena collegato.
  let query: Record<string, string> | null
  let paginaToken: string | undefined
  let fine: string
  if (!opz.incrementale) {
    const { daISO, aISO } = rangeGiorniISO(opz.dal, opz.al)
    const a = istante(aISO) < istante(prima) ? aISO : prima
    const da = istante(daISO) < istante(a) ? daISO : new Date(istante(a) - 60000).toISOString()
    query = { createdAfter: da, createdBefore: a, fulfillmentStatuses: STATI_APERTI }
    fine = a
  } else if (sync.ripresa && sync.ripresa.scade > ora) {
    query = sync.ripresa.query
    paginaToken = sync.ripresa.token
    fine = sync.ripresa.fine
  } else if (sync.cursore && istante(sync.cursore) < istante(prima)) {
    query = { lastUpdatedAfter: sync.cursore, lastUpdatedBefore: prima, fulfillmentStatuses: STATI_TUTTI }
    fine = prima
  } else if (sync.cursore) {
    query = null   // cursore davanti a "adesso meno il margine" (giro appena fatto): niente da leggere
    fine = sync.cursore
  } else {
    query = { createdAfter: new Date(ora - GIORNI_PRIMO_GIRO * 86400000).toISOString(), createdBefore: prima, fulfillmentStatuses: STATI_APERTI }
    fine = prima
  }

  const letti: string[] = []
  const falliti = new Set<string>()
  let importati = 0, annullati = 0
  let interrotta: 'limite' | 'tempo' | null = null
  const avvio = Date.now()
  const tempoMax = opz.incrementale ? TEMPO_MAX_CRON_MS : TEMPO_MAX_PAGINA_MS
  const conta = (es: EsitoPagina) => { importati += es.salvati; annullati += es.annullati; es.falliti.forEach(id => falliti.add(id)) }

  // 1. Gli ordini rimasti indietro dai giri precedenti, uno per uno.
  const riprovati = new Set<string>()
  if (opz.incrementale && sync.da_riprovare) {
    for (const id of Object.keys(sync.da_riprovare).slice(0, RIPROVA_PER_GIRO)) {
      try {
        const r = await spapi(token, 'GET', `${PERCORSO}/${encodeURIComponent(id)}`, { query: { includedData: DATI }, tentativi: 1 })
        if (r?.order) { conta(await salvaPagina(db, integr, [r.order])); letti.push(id) }
        riprovati.add(id)
      } catch (e) {
        if (e instanceof LimiteAmazon) break
        falliti.add(id); riprovati.add(id)
      }
    }
  }

  // 2. La lettura vera e propria, pagina per pagina.
  const fissi = { marketplaceIds: MARKETPLACE_IT, fulfilledBy: 'MERCHANT', maxResultsPerPage: '100', includedData: DATI }
  while (query) {
    let r: any
    try {
      // Un solo tentativo in piu' sul limite: aspettare i 3 minuti di Amazon qui dentro
      // terrebbe ferma la funzione; meglio salvare il punto e riprendere al giro dopo.
      r = await spapi(token, 'GET', PERCORSO, { query: { ...query, ...fissi, paginationToken: paginaToken }, tentativi: 1 })
    } catch (e) {
      if (e instanceof LimiteAmazon) { interrotta = 'limite'; break }
      throw e
    }
    const ordini: any[] = Array.isArray(r?.orders) ? r.orders : []
    conta(await salvaPagina(db, integr, ordini))
    letti.push(...ordini.map(o => String(o?.orderId || '')).filter(Boolean))

    paginaToken = r?.pagination?.nextToken || undefined
    if (!paginaToken) {
      // Lettura completa: il prossimo giro parte da dove Amazon dice di essere arrivato, se il
      // valore e' una data valida; altrimenti dal nostro "adesso meno il margine".
      const dettoDaAmazon = istante(r?.lastUpdatedBefore)
      if (query.lastUpdatedAfter && Number.isFinite(dettoDaAmazon)) fine = new Date(dettoDaAmazon).toISOString()
      break
    }
    if (Date.now() - avvio > tempoMax) { interrotta = 'tempo'; break }
  }

  // 3. Il punto da cui ripartire: solo per il giro automatico (il tasto in pagina legge un periodo
  // scelto a mano e non deve spostare il cursore degli aggiornamenti).
  let esauriti = 0
  if (opz.incrementale) {
    const nuovo: StatoSync = { ...sync }
    if (interrotta && paginaToken && query) nuovo.ripresa = { query, token: paginaToken, fine, scade: Date.now() + 23 * 3600 * 1000 }
    else if (!interrotta) { delete nuovo.ripresa; nuovo.cursore = fine }
    // (fermata prima ancora della prima pagina: niente da spostare, si riprova uguale al giro dopo)
    const prossimi: Record<string, number> = {}
    for (const [id, n] of Object.entries(sync.da_riprovare || {})) {
      if (!riprovati.has(id)) prossimi[id] = n          // non ancora tentato in questo giro
      else if (falliti.has(id)) {
        if (n + 1 < RIPROVA_MAX) prossimi[id] = n + 1
        else { esauriti++; console.error('[AMAZON SYNC] ordine', id, 'non salvato dopo', RIPROVA_MAX, 'giri: lasciato') }
      }
    }
    for (const id of falliti) if (!(id in prossimi) && !riprovati.has(id)) prossimi[id] = 0
    if (Object.keys(prossimi).length) nuovo.da_riprovare = prossimi
    else delete nuovo.da_riprovare
    await aggiornaCredenzialiAmazon(db, integr, attuali => ({ ...attuali, sync: nuovo }))
  }

  // Log senza dati dei compratori: solo conteggi e il negozio.
  console.log(`[AMAZON SYNC] cliente=${integr.cliente_id} negozio="${integr.nome_negozio}" letti=${letti.length} salvati=${importati} annullati=${annullati} falliti=${falliti.size} interrotta=${interrotta || 'no'}`)

  const errore = falliti.size
    ? `${falliti.size} ordini Amazon non salvati: si riprovano al prossimo giro`
    : esauriti ? `${esauriti} ordini Amazon non salvati dopo ${RIPROVA_MAX} tentativi` : null
  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: letti.length, errore })
    .eq('id', integr.id)

  const { spediti, daSpedire } = await contaStatiSincronizzati(db, integr.id, letti)
  const avviso = !interrotta ? null
    : opz.incrementale ? 'Amazon limita le letture: gli ordini rimanenti arrivano nei prossimi giri automatici.'
    : 'Amazon limita le letture: importati i primi ordini del periodo. Per i successivi riprova tra qualche minuto.'
  return { letti: letti.length, importati, spediti, daSpedire, annullati, completa: !interrotta, avviso }
}

type EsitoPagina = { salvati: number; annullati: number; falliti: string[] }

// Una pagina di ordini Amazon → ordini_ecommerce.
//  - Da spedire e recenti: la riga intera, dati del compratore compresi (UNA scrittura a blocchi;
//    senza `stato`, cosi' una riga gia' presente tiene il suo: unita, spedita da noi, ecc.).
//  - Spediti o annullati su Amazon: solo lo stato delle righe che ci sono gia' (allineaStati).
// Se il blocco fallisce si riprova riga per riga, per non perdere le buone; quelle che falliscono
// tornano indietro e si rileggono al giro dopo.
async function salvaPagina(db: any, integr: any, ordini: any[]): Promise<EsitoPagina> {
  const soglia = Date.now() - GIORNI_DATI * 86400000
  const aperti: any[] = [], spediti: string[] = [], daAnnullare: string[] = []
  for (const o of ordini) {
    const id = String(o?.orderId || '')
    if (!id) continue
    const stato = String(o?.fulfillment?.fulfillmentStatus || '')
    if (stato === 'CANCELLED') { daAnnullare.push(id); continue }
    if (stato === 'SHIPPED') { spediti.push(id); continue }
    // In attesa di pagamento/disponibilita': Amazon non da' ancora l'indirizzo. Arrivera' come
    // UNSHIPPED in un giro successivo (e' un aggiornamento dell'ordine).
    if (stato !== 'UNSHIPPED' && stato !== 'PARTIALLY_SHIPPED') continue
    if (!(istante(o?.createdTime) >= soglia)) continue   // troppo vecchio (o senza data): niente dati personali
    const riga = rigaOrdine(integr, o, stato)
    if (riga) aperti.push(riga)
  }

  const falliti: string[] = []
  let salvati = 0
  if (aperti.length) {
    const { error } = await db.from('ordini_ecommerce').upsert(aperti, { onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false })
    if (!error) salvati += aperti.length
    else {
      for (const riga of aperti) {
        const { error: e1 } = await db.from('ordini_ecommerce').upsert(riga, { onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false })
        if (e1) { falliti.push(riga.ordine_esterno_id); console.error('[AMAZON SYNC] upsert KO ordine', riga.ordine_esterno_id, '-', e1.message) }
        else salvati++
      }
    }
  }
  const s = await allineaStati(db, integr, spediti, 'spedito', 'SHIPPED')
  const a = await allineaStati(db, integr, daAnnullare, 'annullato', 'CANCELLED')
  return { salvati, annullati: a.cambiati, falliti: [...falliti, ...s.falliti, ...a.falliti] }
}

// Spedito o annullato SU AMAZON: si aggiornano le sole righe gia' presenti e mai spedite da noi.
// Come per WooCommerce (lib/wooSync): un ordine semplice cambia stato (esce dai "Da spedire");
// un ordine UNITO, o il CAPOFILA di un'unione, tiene il suo stato e riceve solo lo stato del
// negozio — e' da li' che il pacco lascia fuori la merce di un ordine annullato (lib/ordini-uniti).
// Senza questa distinzione un capofila annullato nasconderebbe gli ordini validi uniti a lui, e un
// ordine unito gia' confermato tornerebbe "spedito" senza spedizione, cioe' rispedibile.
async function allineaStati(db: any, integr: any, ids: string[], verso: 'spedito' | 'annullato', statoNegozio: 'SHIPPED' | 'CANCELLED'): Promise<{ cambiati: number; falliti: string[] }> {
  if (!ids.length) return { cambiati: 0, falliti: [] }
  const { data: righe, error } = await db.from('ordini_ecommerce').select('id,ordine_esterno_id,stato,stato_pagamento')
    .eq('integrazione_id', integr.id).in('ordine_esterno_id', ids).is('spedizione_id', null)
  if (error) { console.error('[AMAZON SYNC] lettura stati KO -', error.message); return { cambiati: 0, falliti: ids } }
  if (!righe?.length) return { cambiati: 0, falliti: [] }
  let capofila: Set<string>
  try { capofila = await capofilaDiUnioni(db, righe.map((r: any) => r.id)) }
  catch (e: any) { console.error('[AMAZON SYNC]', e.message); return { cambiati: 0, falliti: righe.map((r: any) => r.ordine_esterno_id) } }

  const semplici = righe.filter((r: any) => r.stato === 'da_spedire' && !capofila.has(r.id))
  const soloNegozio = righe.filter((r: any) => (r.stato === 'unito' || capofila.has(r.id)) && r.stato_pagamento !== statoNegozio)
  let cambiati = 0
  const falliti: string[] = []
  if (semplici.length) {
    // Le guardie stanno NELLA scrittura: solo se ancora da spedire e senza spedizione collegata
    // (nel frattempo il cliente puo' averlo spedito).
    const { data, error: e1 } = await db.from('ordini_ecommerce').update({ stato: verso, stato_pagamento: statoNegozio })
      .eq('integrazione_id', integr.id).in('id', semplici.map((r: any) => r.id)).is('spedizione_id', null).eq('stato', 'da_spedire')
      .select('id')
    if (e1) { console.error('[AMAZON SYNC] stato KO -', e1.message); falliti.push(...semplici.map((r: any) => r.ordine_esterno_id)) }
    else cambiati += (data || []).length
  }
  if (soloNegozio.length) {
    const { error: e2 } = await db.from('ordini_ecommerce').update({ stato_pagamento: statoNegozio })
      .eq('integrazione_id', integr.id).in('id', soloNegozio.map((r: any) => r.id)).is('spedizione_id', null)
    if (e2) { console.error('[AMAZON SYNC] stato negozio KO -', e2.message); falliti.push(...soloNegozio.map((r: any) => r.ordine_esterno_id)) }
  }
  return { cambiati: verso === 'annullato' ? cambiati : 0, falliti }
}

// Un ordine Amazon da spedire → la riga di ordini_ecommerce, senza `stato`. Null se non resta
// niente da spedire (ordine parzialmente spedito con tutti gli articoli gia' partiti).
function rigaOrdine(integr: any, o: any, stato: string): any | null {
  const id = String(o.orderId)
  // Parzialmente spedito: si spedisce (e si conferma) solo quello che manca. Gli articoli gia'
  // partiti non si pesano, non si imballano e non si confermano una seconda volta.
  const articoli = (Array.isArray(o?.orderItems) ? o.orderItems : []).map((it: any) => {
    const ordinati = Number(it?.quantityOrdered) || 0
    const mancanti = Number.isFinite(Number(it?.fulfillment?.quantityUnfulfilled))
      ? Number(it.fulfillment.quantityUnfulfilled)
      : ordinati - (Number(it?.fulfillment?.quantityFulfilled) || 0)
    return {
      nome: it?.product?.title || it?.product?.sellerSku || '',
      quantita: stato === 'PARTIALLY_SHIPPED' ? mancanti : ordinati,
      grammi: 0,
      sku: it?.product?.sellerSku || '',
      // Serve alla conferma di spedizione (lib/amazonFulfill): Amazon evade articolo per articolo.
      order_item_id: String(it?.orderItemId || ''),
      prezzo: it?.product?.price?.unitPrice?.amount != null ? Number(it.product.price.unitPrice.amount) : null,
    }
  }).filter((x: any) => x.quantita > 0)
  if (!articoli.length) return null

  const a = o?.recipient?.deliveryAddress || {}
  const paese = String(a.countryCode || 'IT').toUpperCase()
  const cap = String(a.postalCode || '').trim()
  // Provincia: Amazon scrive il nome esteso, la regione o niente. Per l'Italia si porta a sigla,
  // e se non lo e' si ricava dal CAP, come per gli ordini Amazon da file.
  let provincia = String(a.stateOrRegion || '').trim()
  if (paese === 'IT') {
    const s = siglaProvincia(provincia)
    provincia = SIGLE_IT.has(s) ? s : (CAP_PROVINCIA.get(cap) || '')
  }
  const nome = String(a.name || o?.buyer?.buyerName || '').trim()
  const azienda = String(a.companyName || '').trim()
  const destinatario = {
    nome: azienda && azienda.toLowerCase() !== nome.toLowerCase() ? `${nome} - ${azienda}` : nome,
    indirizzo: [a.addressLine1, a.addressLine2, a.addressLine3].filter(Boolean).join(' '),
    citta: a.city || a.municipality || '',
    provincia,
    cap,
    paese,
    // L'email di Amazon e' un alias anonimo; se manca, il ripiego degli altri negozi: alcuni
    // corrieri rifiutano l'etichetta senza email. Il tracking al cliente lo mandiamo noi.
    email: o?.buyer?.buyerEmail || 'noreply@moovexpress.com',
    telefono: a.phone || '',
  }

  // Contrassegno: se Amazon dice che si paga alla consegna, l'importo e' quello del pagamento.
  const pagamenti: any[] = Array.isArray(o?.payment?.paymentExecutions) ? o.payment.paymentExecutions : []
  const cod = pagamenti.find(p => /cash\s*on\s*delivery|cashondelivery|^cod$/i.test(String(p?.paymentMethod || '')))
  const somma = articoli.reduce((t: number, x: any) => t + (x.prezzo != null ? x.prezzo * x.quantita : 0), 0)
  const totaleAmazon = o?.proceeds?.grandTotal?.amount
  const totale = cod?.paymentAmount?.amount != null ? Number(cod.paymentAmount.amount)
    : totaleAmazon != null ? Number(totaleAmazon) : (somma || null)

  // Istruzioni di consegna del compratore: nella nota, che la lista ordini passa al corriere.
  const pref = o?.recipient?.deliveryPreference || {}
  const nota = [pref.addressInstruction, pref.dropOffLocation].map((x: any) => String(x || '').trim()).filter(Boolean).join(' — ')

  // `raw` E' UN ELENCO CHIUSO, non la risposta intera: dentro la risposta ci sono anche messaggi
  // regalo e link di personalizzazione, dati personali che non servono a spedire. Qui restano le
  // date (la lista ordini legge createdTime), lo stato, il pagamento (da li' riconosce un
  // contrassegno, come per gli altri negozi) e la nota di consegna.
  const raw: any = {
    orderId: id,
    createdTime: o?.createdTime || null,
    lastUpdatedTime: o?.lastUpdatedTime || null,
    fulfillment: {
      fulfillmentStatus: stato,
      fulfillmentServiceLevel: o?.fulfillment?.fulfillmentServiceLevel || null,
      shipByWindow: o?.fulfillment?.shipByWindow || null,
      deliverByWindow: o?.fulfillment?.deliverByWindow || null,
    },
    payment: { paymentExecutions: pagamenti.map(p => ({ paymentMethod: p?.paymentMethod || null, paymentAmount: p?.paymentAmount || null })) },
    proceeds: o?.proceeds?.grandTotal ? { grandTotal: o.proceeds.grandTotal } : null,
    ...(nota ? { note: nota } : {}),
  }

  return {
    cliente_id: integr.cliente_id,
    master_id: integr.master_id,
    integrazione_id: integr.id,
    // Come per gli altri negozi: l'identificativo dell'account SULLA riga, cosi' la cancellazione
    // dei dati lo raggiunge anche se l'integrazione viene tolta.
    shop: integr.identificativo,
    piattaforma: 'amazon',
    ordine_esterno_id: id,
    numero_ordine: id,
    cliente_nome: destinatario.nome,
    destinatario,
    articoli,
    totale,
    valuta: o?.proceeds?.grandTotal?.currencyCode || cod?.paymentAmount?.currencyCode || 'EUR',
    stato_pagamento: stato,
    raw,
  }
}
