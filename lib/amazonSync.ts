import { tokenAmazon, spapi, MARKETPLACE_IT, LimiteAmazon, AutorizzazioneAmazonRevocata } from '@/lib/amazon'
import { contaStatiSincronizzati } from '@/lib/shopifySync'
import { rangeGiorniISO } from '@/lib/ebaySync'
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
// IL LIMITE E' IL TEMPO, NON I DATI. searchOrders concede una chiamata ogni ~3 minuti per
// venditore, dopo una raffica iniziale di 20 (da 100 ordini l'una). Percio':
//  - il giro automatico chiede solo gli ordini CAMBIATI dall'ultima volta (lastUpdatedAfter =
//    cursore salvato), che a ogni passaggio sono poche pagine;
//  - il primo giro di un account appena collegato prende gli ordini APERTI degli ultimi 7 giorni
//    (quelli da spedire): gli ordini gia' spediti non servono a nessuno;
//  - se Amazon ferma la lettura a meta' (limite) o finisce il tempo, si salva il punto (il token
//    di pagina vale 24 ore) e il giro dopo riprende da li': niente ordini persi, niente rilettura.
// Il tasto "Sincronizza" della pagina legge invece il periodo scelto per DATA ORDINE, come per gli
// altri negozi; se il periodo e' piu' grande della raffica, lo dice.

const PERCORSO = '/orders/2026-01-01/orders'
const DATI = 'RECIPIENT,BUYER,FULFILLMENT,PROCEEDS,PAYMENT'
const STATI_TUTTI = 'UNSHIPPED,PARTIALLY_SHIPPED,SHIPPED,CANCELLED'
const STATI_APERTI = 'UNSHIPPED,PARTIALLY_SHIPPED'
// Amazon vuole il "...Before" almeno 2 minuti prima della richiesta: 3 per stare larghi.
const MARGINE_MS = 3 * 60 * 1000
const GIORNI_PRIMO_GIRO = 7
// Il cron sincronizza piu' negozi nello stesso giro e ha un margine fisso per l'ultimo partito:
// il giro automatico si ferma prima del tasto in pagina, che ha la funzione tutta per se'.
const TEMPO_MAX_CRON_MS = 90000
const TEMPO_MAX_PAGINA_MS = 150000

type Opzioni = { dal?: string | null; al?: string | null; incrementale?: boolean }
type Ripresa = { query: Record<string, string>; token: string; fine: string; scade: number }
type Esito = { letti: number; importati: number; spediti: number; daSpedire: number; annullati: number; completa: boolean; avviso: string | null }

const istante = (s?: string) => (s ? Date.parse(s) : NaN)

export async function sincronizzaOrdiniAmazon(db: any, integr: any, opz: Opzioni = {}): Promise<Esito> {
  let token: string
  try {
    token = await tokenAmazon(db, integr)
  } catch (e) {
    if (e instanceof AutorizzazioneAmazonRevocata) {
      // L'autorizzazione non torna da sola: si chiude l'integrazione, cosi' il cron non la
      // ritenta a ogni giro e purge-pii ne cancella i dati entro 30 giorni.
      await db.from('integrazioni').update({ stato: 'disconnesso', errore: e.message }).eq('id', integr.id)
    }
    throw e
  }

  const sync = ((integr.credenziali || {}).sync || {}) as { cursore?: string; ripresa?: Ripresa }
  const ora = Date.now()
  const prima = new Date(ora - MARGINE_MS).toISOString()

  // Quale lettura: il periodo chiesto dalla pagina, la ripresa di una paginazione interrotta,
  // gli aggiornamenti dal cursore, oppure il primo giro di un account appena collegato.
  let query: Record<string, string>
  let paginaToken: string | undefined
  let fine: string
  if (!opz.incrementale) {
    const { daISO, aISO } = rangeGiorniISO(opz.dal, opz.al)
    const a = istante(aISO) < istante(prima) ? aISO : prima
    const da = istante(daISO) < istante(a) ? daISO : new Date(istante(a) - 60000).toISOString()
    query = { createdAfter: da, createdBefore: a, fulfillmentStatuses: STATI_TUTTI }
    fine = a
  } else if (sync.ripresa && sync.ripresa.scade > ora) {
    query = sync.ripresa.query
    paginaToken = sync.ripresa.token
    fine = sync.ripresa.fine
  } else if (sync.cursore) {
    // Cursore davanti a "adesso meno il margine" (giro appena fatto): niente da leggere.
    if (!(istante(sync.cursore) < istante(prima))) {
      return { letti: 0, importati: 0, spediti: 0, daSpedire: 0, annullati: 0, completa: true, avviso: null }
    }
    query = { lastUpdatedAfter: sync.cursore, lastUpdatedBefore: prima, fulfillmentStatuses: STATI_TUTTI }
    fine = prima
  } else {
    query = { createdAfter: new Date(ora - GIORNI_PRIMO_GIRO * 86400000).toISOString(), createdBefore: prima, fulfillmentStatuses: STATI_APERTI }
    fine = prima
  }

  const fissi = { marketplaceIds: MARKETPLACE_IT, fulfilledBy: 'MERCHANT', maxResultsPerPage: '100', includedData: DATI }
  const letti: string[] = []
  let importati = 0, errori = 0, annullati = 0
  let interrotta: 'limite' | 'tempo' | null = null
  const avvio = Date.now()
  const tempoMax = opz.incrementale ? TEMPO_MAX_CRON_MS : TEMPO_MAX_PAGINA_MS

  for (;;) {
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
    const esito = await salvaPagina(db, integr, ordini)
    importati += esito.salvati; annullati += esito.annullati; errori += esito.errori
    letti.push(...ordini.map(o => String(o?.orderId || '')).filter(Boolean))

    paginaToken = r?.pagination?.nextToken || undefined
    if (!paginaToken) {
      // Lettura completa: il prossimo giro parte da dove Amazon dice di essere arrivato.
      if (query.lastUpdatedAfter && r?.lastUpdatedBefore) fine = r.lastUpdatedBefore
      break
    }
    if (Date.now() - avvio > tempoMax) { interrotta = 'tempo'; break }
  }

  // Il punto da cui ripartire si salva solo per il giro automatico: il tasto in pagina legge un
  // periodo scelto a mano e non deve spostare il cursore degli aggiornamenti.
  if (opz.incrementale) {
    const nuovo: { cursore?: string; ripresa?: Ripresa } = { ...sync }
    if (interrotta && paginaToken) {
      nuovo.ripresa = { query, token: paginaToken, fine, scade: Date.now() + 23 * 3600 * 1000 }
    } else if (!interrotta) {
      delete nuovo.ripresa
      nuovo.cursore = fine
    }
    // (fermata prima ancora della prima pagina: niente da salvare, si riprova uguale al giro dopo)
    const credNuove = { ...(integr.credenziali || {}), sync: nuovo }
    await db.from('integrazioni').update({ credenziali: credNuove }).eq('id', integr.id)
    integr.credenziali = credNuove
  }

  // Log senza dati dei compratori: solo conteggi e il negozio.
  console.log(`[AMAZON SYNC] cliente=${integr.cliente_id} negozio="${integr.nome_negozio}" letti=${letti.length} salvati=${importati} annullati=${annullati} errori=${errori} interrotta=${interrotta || 'no'}`)

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: letti.length, errore: null })
    .eq('id', integr.id)

  const { spediti, daSpedire } = await contaStatiSincronizzati(db, integr.id, letti)
  const avviso = !interrotta ? null
    : opz.incrementale ? 'Amazon limita le letture: gli ordini rimanenti arrivano nei prossimi giri automatici.'
    : 'Amazon limita le letture: importati i primi ordini del periodo, i successivi arrivano in automatico nei prossimi giri.'
  return { letti: letti.length, importati, spediti, daSpedire, annullati, completa: !interrotta, avviso }
}

// Una pagina di ordini Amazon → righe di ordini_ecommerce, con DUE scritture a blocchi.
//
// Due e non una: gli ordini spediti su Amazon portano `stato: 'spedito'`, quelli aperti NON
// portano lo stato (una riga gia' presente deve tenere il suo: unita, spedita da noi…). In una
// scrittura unica le righe senza `stato` lo riceverebbero vuoto, e per le righe esistenti vuol
// dire cancellarlo. Se un blocco fallisce si riprova riga per riga, per non perdere le buone.
async function salvaPagina(db: any, integr: any, ordini: any[]): Promise<{ salvati: number; annullati: number; errori: number }> {
  const aperti: any[] = [], spediti: any[] = [], daAnnullare: string[] = []
  for (const o of ordini) {
    const id = String(o?.orderId || '')
    if (!id) continue
    const stato = String(o?.fulfillment?.fulfillmentStatus || '')
    if (stato === 'CANCELLED') { daAnnullare.push(id); continue }
    // In attesa di pagamento/disponibilita': Amazon non da' ancora l'indirizzo. Arrivera' come
    // UNSHIPPED in un giro successivo (e' un aggiornamento dell'ordine).
    if (stato !== 'UNSHIPPED' && stato !== 'PARTIALLY_SHIPPED' && stato !== 'SHIPPED') continue
    const riga = rigaOrdine(integr, o, stato)
    if (stato === 'SHIPPED') spediti.push({ ...riga, stato: 'spedito' })
    else aperti.push(riga)
  }

  let salvati = 0, errori = 0, annullati = 0
  for (const blocco of [aperti, spediti]) {
    if (!blocco.length) continue
    const { error } = await db.from('ordini_ecommerce').upsert(blocco, { onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false })
    if (!error) { salvati += blocco.length; continue }
    for (const riga of blocco) {
      const { error: e1 } = await db.from('ordini_ecommerce').upsert(riga, { onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false })
      if (e1) { errori++; console.error('[AMAZON SYNC] upsert KO ordine', riga.ordine_esterno_id, '-', e1.message) }
      else salvati++
    }
  }

  // ANNULLATO SU AMAZON: non si crea una riga per un ordine che non c'e' piu'. Se c'era gia' ed
  // e' ancora da spedire, senza spedizione collegata, esce dai "Da spedire" — le stesse guardie
  // degli altri negozi (lib/wooSync): mai una riga con la spedizione collegata.
  if (daAnnullare.length) {
    const { data, error } = await db.from('ordini_ecommerce')
      .update({ stato: 'annullato', stato_pagamento: 'CANCELLED' })
      .eq('integrazione_id', integr.id).in('ordine_esterno_id', daAnnullare)
      .is('spedizione_id', null).eq('stato', 'da_spedire')
      .select('id')
    if (error) { errori += daAnnullare.length; console.error('[AMAZON SYNC] annullo KO -', error.message) }
    else annullati = (data || []).length
  }
  return { salvati, annullati, errori }
}

// Un ordine Amazon (aperto o spedito) → la riga di ordini_ecommerce, senza `stato`.
function rigaOrdine(integr: any, o: any, stato: string): any {
  const id = String(o.orderId)
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

  const articoli = (Array.isArray(o?.orderItems) ? o.orderItems : []).map((it: any) => ({
    nome: it?.product?.title || it?.product?.sellerSku || '',
    quantita: Number(it?.quantityOrdered) || 1,
    grammi: 0,
    sku: it?.product?.sellerSku || '',
    // Serve alla conferma di spedizione (lib/amazonFulfill): Amazon evade articolo per articolo.
    order_item_id: String(it?.orderItemId || ''),
    prezzo: it?.product?.price?.unitPrice?.amount != null ? Number(it.product.price.unitPrice.amount) : null,
  }))
  const somma = articoli.reduce((t: number, x: any) => t + (x.prezzo != null ? x.prezzo * x.quantita : 0), 0)
  const totaleAmazon = o?.proceeds?.grandTotal?.amount
  const totale = totaleAmazon != null ? Number(totaleAmazon) : (somma || null)

  // `raw` SENZA i dati personali: destinatario e compratore stanno gia' in `destinatario`, e
  // copiarli anche qui ne raddoppierebbe la conservazione. Restano stato, date, articoli e
  // pagamento (da li' la lista riconosce un eventuale contrassegno, come per gli altri negozi).
  const { recipient: _destinatario, buyer: _compratore, ...raw } = o

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
    valuta: o?.proceeds?.grandTotal?.currencyCode || 'EUR',
    stato_pagamento: stato,
    raw,
  }
}
