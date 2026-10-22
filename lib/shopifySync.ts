import {
  getValidShopifyToken, shopifyGraphQL, classificaEvasioni, evasioniNostre, fotoOrdine, statoDaShopify,
  PREFISSO_ANNULLO, testoAnnullatoStore, type ClassificaEvasioni,
} from '@/lib/shopify'
import { rangeGiorniISO } from '@/lib/ebaySync'
import { assorbitiDi, assorbitiNelPacco } from '@/lib/ordini-uniti'
import { ESITI_EVASIONE, spedizioneDelPacco } from '@/lib/evasione-ordini'

// Sincronizza gli ordini di Shopify in ordini_ecommerce NELLA FINESTRA DATE richiesta (default 30gg).
// db: client Supabase (user-scoped dal portale, admin dall'app embedded).
// L'integrazione porta con sé cliente_id/master_id: funziona in entrambi i contesti.
export async function sincronizzaOrdiniShopify(db: any, integr: any, range?: { dal?: string | null; al?: string | null }): Promise<{ letti: number; importati: number; spediti: number; daSpedire: number; annullati: number }> {
  const cred = integr.credenziali as any
  const shop = cred?.shop
  if (!shop) throw new Error('Credenziali Shopify mancanti')
  const tk = await getValidShopifyToken(integr, db)
  if (tk.error || !tk.token) throw new Error(tk.error || 'Token non disponibile')
  const token = tk.token
  // FINESTRA DATE: si importa SOLO l'intervallo scelto in pagina (oggi -> solo oggi; il mese -> il
  // mese). created_at di Shopify e' un timestamp: uso gli estremi ISO gia' pronti (margine orario).
  const { daISO, aISO } = rangeGiorniISO(range?.dal, range?.al)
  // FILTRO SU created_at, come la lista e come gli altri canali: il periodo scelto e' la DATA ORDINE.
  // Prima era updated_at, per ripescare gli ordini modificati dopo la creazione — ma cosi' "la
  // settimana scorsa" perdeva gli ordini creati la settimana scorsa e toccati dopo (evasi, indirizzo
  // corretto), e "oggi" importava ordini vecchi che la lista, filtrando per data ordine, non mostrava.
  // Le modifiche successive le riprende il cron, che rilegge gli ultimi 30 giorni a ogni giro.
  const filtroData = `created_at:>=${daISO} created_at:<=${aISO}`

  // Ordini via GraphQL (immagini inline), i piu' RECENTI prima, paginati fino a ~3000. Prendiamo sia
  // gli EVASI sia i NON evasi (status:open, senza filtro fulfillment): cosi' anche gli ordini gia'
  // evasi su Shopify entrano con la loro DATA e gateway veri (prima, prendendo solo i non-evasi, gli
  // evasi non venivano mai riletti e restavano con la data di IMPORT). Un ordine NUOVO gia' evaso entra
  // 'spedito'; per le righe che abbiamo gia', chi diventa 'spedito' lo decide allineaEvasiShopify.
  // `cancelledAt` e' uno scalare senza dati personali: dice se il negoziante ha annullato l'ordine.
  const ordini: any[] = []
  let cursor: string | null = null
  // true solo se abbiamo scaricato TUTTI gli ordini aperti della finestra: nessuna pagina troncata dal
  // tetto e nessuna risposta senza ordini. Senza, «non c'e' fra gli aperti» non vuol dire niente
  // (allineaEvasiShopify).
  let completa = false
  // Tetto a 30 pagine (~3000 ordini nella finestra date scelta): prima era 3 (300) e chi aveva piu' di
  // 300 ordini modificati nella finestra ne perdeva una parte.
  for (let page = 0; page < 30; page++) {
    const data: any = await shopifyGraphQL(shop, token, `
      query($cursor: String){
        orders(first: 100, after: $cursor, query: "status:open ${filtroData}", sortKey: CREATED_AT, reverse: true){
          edges { node {
            legacyResourceId name email phone note createdAt updatedAt cancelledAt paymentGatewayNames displayFinancialStatus displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            shippingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
            billingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
            lineItems(first: 100){ edges { node { title name variantTitle quantity sku image { url } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { cursor })
    const conn = data?.orders
    if (!conn) break
    for (const e of (conn.edges || [])) ordini.push(e.node)
    if (!conn.pageInfo?.hasNextPage) { completa = true; break }
    cursor = conn.pageInfo.endCursor
  }

  // Le righe che abbiamo GIA' per questi ordini: il loro stato non si riscrive alla cieca (sotto).
  // Senza sapere quali righe sono nuove si tornerebbe a sovrascrivere tutto: meglio una sync fallita,
  // che si riprova al giro dopo.
  const esistenti = await righeShopifyEsistenti(db, integr.id, ordini.map((o: any) => String(o.legacyResourceId)))
  // Gli ordini di un negozio ricollegato allo stesso cliente riprendono le loro righe (vedi la funzione).
  // Best-effort: se non riesce, l'ordine nasce su una riga nuova come prima, e si riprova al giro dopo.
  try {
    const riprese = await riprendiRigheOrfane(db, integr, ordini.map((o: any) => String(o.legacyResourceId)).filter((id: string) => !esistenti.has(id)))
    for (const r of riprese) esistenti.set(String(r.ordine_esterno_id), r)
  } catch (e: any) { console.error('[SHOPIFY SYNC] ripresa righe orfane (best-effort):', integr.id, String(e?.message || e).slice(0, 200)) }

  let importati = 0
  for (const o of ordini) {
    // DESTINATARIO con RIPIEGO: se l'indirizzo di SPEDIZIONE e' vuoto (capita su ordini/bozze dove e'
    // stata compilata solo la fatturazione), si usa la FATTURAZIONE. NB: il nome del CLIENTE non si usa
    // piu' come ripiego — il campo `customer` richiede lo scope read_customers (che non chiediamo, e non
    // serve): il nome viene da shippingAddress/billingAddress, presente su ogni ordine spedibile.
    const ship = o.shippingAddress || {}
    const bill = o.billingAddress || {}
    const haSpedizione = !!(ship.name || ship.address1 || ship.city || ship.zip)
    const addr = haSpedizione ? ship : bill
    const nomeDest = ship.name || bill.name || ''
    const destinatario = {
      nome: nomeDest,
      indirizzo: [addr.address1, addr.address2].filter(Boolean).join(' '),
      citta: addr.city || '',
      provincia: addr.provinceCode || addr.province || '',
      cap: addr.zip || '',
      paese: addr.countryCodeV2 || 'IT',
      email: o.email || '',
      telefono: ship.phone || bill.phone || o.phone || '',
    }
    // NOME CON LA VARIANTE. `title` e' il solo nome del prodotto: un ordine di "The Complete
    // Snowboard" nella variante "Ice" arrivava come "The Complete Snowboard", e chi prepara il pacco
    // non sa quale prendere. Si usa `name`, che Shopify compone gia' col nome della variante quando
    // ce n'e' una vera — e a differenza di `variantTitle` non scrive "Default Title" sui prodotti
    // che varianti non ne hanno.
    const articoli = (o.lineItems?.edges || []).map((e: any) => ({
      nome: e.node.name || e.node.title,
      variante: e.node.variantTitle && e.node.variantTitle !== 'Default Title' ? e.node.variantTitle : null,
      quantita: e.node.quantity, grammi: 0, sku: e.node.sku || '',
      immagine: e.node.image?.url || null,
    }))
    const money = o.totalPriceSet?.shopMoney
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      // Dominio del negozio SULLA riga: i redact GDPR filtrano su questo. Non su integrazione_id,
      // che sparisce se qualcuno cancella l'integrazione e lascia gli ordini orfani — e un ordine
      // orfano nessuna cancellazione lo raggiunge piu' (erano 4.147 il 9/09/2026).
      shop: integr.identificativo,
      piattaforma: 'shopify',
      ordine_esterno_id: String(o.legacyResourceId),
      numero_ordine: o.name || '',
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: money?.amount ? Number(money.amount) : null,
      valuta: money?.currencyCode || 'EUR',
      // Un ordine annullato sul negozio vale 'cancelled', lo stesso valore di WooCommerce: e' quello
      // che il pacco di un'unione lascia fuori (lib/ordini-uniti) e che la pagina mostra in rosso.
      stato_pagamento: o.cancelledAt ? 'cancelled' : (o.displayFinancialStatus || '').toLowerCase(),
      // `raw` POTATO, non l'ordine intero.
      //
      // Prima ci finiva `o` per intero: nome, indirizzo di spedizione E di fatturazione, email e
      // telefono del compratore duplicati una seconda volta, dentro un campo che nessuna schermata
      // mostra. Il primo requisito dei dati protetti di Shopify e' non tenere piu' di quello che
      // serve, e qui a valle servono sei chiavi, tutte non personali: la data vera dell'ordine
      // (usata dal filtro periodo) e il metodo di pagamento (per riconoscere il contrassegno).
      // Il destinatario resta nel suo campo, uno solo, che il purge sa azzerare.
      raw: {
        createdAt: o.createdAt, updatedAt: o.updatedAt,
        // La NOTA che il negoziante (o il compratore) ha scritto sull'ordine. Prima non la
        // chiedevamo nemmeno: chi spediva dal portale non la vedeva, e istruzioni tipo "citofono
        // rotto, chiamare prima" restavano sul negozio. Va al corriere insieme all'indirizzo.
        note: o.note || null,
        paymentGatewayNames: o.paymentGatewayNames,
        displayFinancialStatus: o.displayFinancialStatus,
        displayFulfillmentStatus: o.displayFulfillmentStatus,
        totalPriceSet: o.totalPriceSet,
        cancelledAt: o.cancelledAt || null,
      },
    }
    // LO STATO SI SCRIVE SOLO SULLE RIGHE NUOVE: gia' evaso su Shopify -> 'spedito' (sparisce dal
    // default "da spedire"), annullato -> 'annullato'; gli altri nascono 'da_spedire'. Sulle righe che
    // abbiamo gia' lo stato non entra piu' nell'upsert: qui 'spedito' sovrascriveva qualunque stato,
    // anche 'unito' (un assorbito che evadiamo noi diventava spedibile in massa) e la riga di un ordine
    // di cui avevamo appena annullato la spedizione, che su Shopify risultava ancora evaso col tracking
    // morto e spariva da «Da spedire» col pacco mai partito. Per quelle decide allineaEvasiShopify.
    if (!esistenti.has(String(o.legacyResourceId))) {
      if (o.cancelledAt) payload.stato = 'annullato'
      else if (String(o.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED') payload.stato = 'spedito'
    }
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  // ANNULLATI E CHIUSI SUL NEGOZIO. Prima gli ordini 'da_spedire' spariti dagli aperti diventavano
  // tutti 'spedito', annullati compresi, e nessuna riga Shopify diventava mai 'annullato' come su
  // WooCommerce e PrestaShop. Ora: gli annullati si leggono a parte (status:cancelled, solo id e data
  // d'annullo) e chi diventa 'spedito' si decide rileggendo per id. Tutte e tre le letture sono un di
  // piu': se si rompono, l'import resta valido e le righe restano come sono fino al giro dopo.
  // Ma non in silenzio: cio' che non e' andato finisce nell'errore dell'integrazione (lo legge il
  // controllo «Log & Errori»), invece di un `errore: null` che diceva tutto a posto.
  const avvisi: string[] = []
  const nota = (fase: string, e: any) => {
    const msg = String(e?.message || e).slice(0, 200)
    console.error(`[SHOPIFY SYNC] ${fase} (best-effort):`, integr.id, msg)
    avvisi.push(`${fase}: ${msg}`)
  }
  const annullatiIds = new Set<string>(ordini.filter((o: any) => o.cancelledAt).map((o: any) => String(o.legacyResourceId)))
  try {
    for (const id of await ordiniAnnullatiShopify(shop, token, daISO)) annullatiIds.add(id)
  } catch (e: any) { nota('lettura annullati', e) }
  try {
    const allineati = await allineaEvasiShopify(db, integr, shop, token, ordini, completa, daISO, aISO)
    for (const id of allineati.annullati) annullatiIds.add(id)
    if (allineati.nonVerificate) avvisi.push(`${allineati.nonVerificate} ordini evasi sul negozio non verificati, si riprova al prossimo giro`)
  } catch (e: any) { nota('lettura per id', e) }
  let annullati = 0
  try {
    annullati = await segnaAnnullatiShopify(db, integr, Array.from(annullatiIds))
  } catch (e: any) { nota('annullati', e) }

  await db.from('integrazioni')
    // sync riuscita: azzera un errore precedente (non piu' appiccicato quando lo store rientra), oppure
    // dice quale parte non e' andata.
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length, errore: avvisi.length ? ('Ordini importati, ma: ' + avvisi.join(' | ')).slice(0, 500) : null })
    .eq('id', integr.id)

  // Quanti dei sincronizzati risultano GIA' SPEDITI vs DA SPEDIRE: leggo lo stato FINALE dal DB (così
  // rispetta lo stato delle righe che avevamo gia' e le chiusure qui sopra). Chunk sull'.in() (tronca oltre ~100).
  // Gli annullati qui contano fra i "da spedire", come per WooCommerce: la funzione e' condivisa con le
  // altre sync e non si tocca; la pagina li dice a parte col numero `annullati`.
  const { spediti, daSpedire } = await contaStatiSincronizzati(db, integr.id, ordini.map((o: any) => String(o.legacyResourceId)))
  return { letti: ordini.length, importati, spediti, daSpedire, annullati }
}

type RigaShopify = { id: string; ordine_esterno_id: string; stato: string | null; spedizione_id: string | null; unito_in: string | null; fulfillment_stato: string | null }

// Le righe gia' presenti per gli ordini letti, per id esterno, a blocchi di 200.
async function righeShopifyEsistenti(db: any, integrazioneId: string, idsEsterni: string[]): Promise<Map<string, RigaShopify>> {
  const m = new Map<string, RigaShopify>()
  for (let i = 0; i < idsEsterni.length; i += 200) {
    const { data, error } = await db.from('ordini_ecommerce').select('id,ordine_esterno_id,stato,spedizione_id,unito_in,fulfillment_stato')
      .eq('integrazione_id', integrazioneId).in('ordine_esterno_id', idsEsterni.slice(i, i + 200))
    if (error) throw new Error('lettura ordini esistenti: ' + error.message)
    for (const r of data || []) m.set(String(r.ordine_esterno_id), r as RigaShopify)
  }
  return m
}

// UN NEGOZIO RICOLLEGATO ALLO STESSO CLIENTE RIPRENDE LE SUE RIGHE, CON LA SPEDIZIONE ATTACCATA.
// «Scollega» cancella la riga dell'integrazione e lascia gli ordini, col dominio del negozio (shop) ma col
// vecchio integrazione_id. Riaprendo l'app da Shopify nasce un'integrazione nuova, e la sync salva per
// (integrazione_id, ordine_esterno_id): ogni ordine rinasceva su una riga nuova, senza la spedizione con cui
// l'avevamo evaso. La pagina offriva di nuovo «Crea spedizione» su un ordine gia' spedito da noi (Lorenzo,
// 22/10/2026, ordine #1028 del negozio di prova evaso con 282343J010995), e sul negozio di prova lo stesso
// ordine era arrivato a 5 righe (#1019). Qui, prima di salvare, un ordine senza riga nell'integrazione nuova
// riprende quella rimasta orfana: stesso negozio, stesso cliente, integrazione che non esiste piu'. Fra piu'
// orfane si prende quella con la spedizione, poi la piu' recente. MAI fra clienti diversi: se il negozio
// passa a un altro conto, gli ordini del conto di prima restano suoi.
async function riprendiRigheOrfane(db: any, integr: any, idsEsterni: string[]): Promise<RigaShopify[]> {
  if (!idsEsterni.length || !integr?.identificativo || !integr?.cliente_id) return []
  const candidate: any[] = []
  for (let i = 0; i < idsEsterni.length; i += 200) {
    const { data, error } = await db.from('ordini_ecommerce')
      .select('id,ordine_esterno_id,integrazione_id,stato,spedizione_id,unito_in,fulfillment_stato,created_at')
      .eq('piattaforma', 'shopify').eq('shop', integr.identificativo).eq('cliente_id', integr.cliente_id)
      .neq('integrazione_id', integr.id).in('ordine_esterno_id', idsEsterni.slice(i, i + 200))
    if (error) throw new Error('lettura righe orfane: ' + error.message)
    candidate.push(...(data || []))
  }
  if (!candidate.length) return []
  // Solo le righe la cui integrazione non c'e' piu': quelle di un'integrazione viva non si toccano.
  const integrIds = Array.from(new Set(candidate.map(r => String(r.integrazione_id))))
  const vive = new Set<string>()
  for (let i = 0; i < integrIds.length; i += 200) {
    const { data, error } = await db.from('integrazioni').select('id').in('id', integrIds.slice(i, i + 200))
    if (error) throw new Error('lettura integrazioni delle righe orfane: ' + error.message)
    for (const r of data || []) vive.add(String(r.id))
  }
  const migliore = new Map<string, any>()
  for (const r of candidate) {
    if (vive.has(String(r.integrazione_id))) continue
    const k = String(r.ordine_esterno_id)
    const m = migliore.get(k)
    const meglio = !m || (!!r.spedizione_id && !m.spedizione_id) || (!!r.spedizione_id === !!m.spedizione_id && String(r.created_at) > String(m.created_at))
    if (meglio) migliore.set(k, r)
  }
  const riprese: RigaShopify[] = []
  for (const r of migliore.values()) {
    // La condizione sull'integrazione vecchia: se un altro giro l'ha gia' ripresa, non si scrive due volte.
    const { data, error } = await db.from('ordini_ecommerce').update({ integrazione_id: integr.id, master_id: integr.master_id })
      .eq('id', r.id).eq('integrazione_id', r.integrazione_id).select('id,ordine_esterno_id,stato,spedizione_id,unito_in,fulfillment_stato')
    if (error) throw new Error('ripresa riga orfana: ' + error.message)
    if (data?.[0]) riprese.push(data[0] as RigaShopify)
  }
  if (riprese.length) console.log('[SHOPIFY SYNC] righe orfane riprese:', integr.id, riprese.length)
  return riprese
}

// Gli ordini ANNULLATI sul negozio aggiornati nella finestra: solo id e data d'annullo, niente dati
// personali. La lista degli aperti non li restituisce piu', ed e' per questo che finivano 'spedito'.
const ANNULLATI_PAGINE = 8   // fino a 2000 annullati per giro
async function ordiniAnnullatiShopify(shop: string, token: string, daISO: string): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < ANNULLATI_PAGINE; page++) {
    const data: any = await shopifyGraphQL(shop, token, `
      query($cursor: String){
        orders(first: 250, after: $cursor, query: "status:cancelled updated_at:>=${daISO}", reverse: true){
          edges { node { legacyResourceId cancelledAt } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { cursor })
    const conn = data?.orders
    for (const e of (conn?.edges || [])) if (e?.node?.cancelledAt) ids.push(String(e.node.legacyResourceId))
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }
  return ids
}

// CHI DIVENTA 'spedito', RILEGGENDO PER ID.
//
// Prima c'erano due regole cieche: lo 'spedito' nell'upsert per ogni ordine evaso, e «da spedire ma non
// piu' fra gli aperti -> spedito». Tutte e due chiudevano anche l'ordine di una spedizione che avevamo
// appena annullato: su Shopify restava evaso col nostro tracking morto (l'annullo non arrivava), oppure
// pagato e archiviato, e la riga spariva da «Da spedire» col pacco mai partito.
// Ora, per le righe 'da_spedire' senza spedizione e non unite, nella finestra, il cui ordine risulta
// evaso fra gli aperti o (solo con la lista completa, vedi sotto) non c'e' piu', si chiede a Shopify
// l'ordine per id (25 alla volta, solo stato ed evasioni: niente dati personali) e decide statoDaShopify,
// la stessa regola dell'annullo delle evasioni (lib/shopify), sul modello dell'allineamento di WooCommerce:
//  - evaso senza evasioni nostre morte -> 'spedito' (anche dopo un nostro annullo, se l'ha evaso il
//    negoziante a mano: senza, l'invio di massa comprerebbe una seconda etichetta);
//  - un'evasione nostra morta ancora attiva -> resta 'da_spedire'; se la riga non ne portava traccia
//    diventa candidata dell'annullo ('errore' col testo dell'annullo, tentativi da zero);
//  - archiviato o eliminato senza storia nostra -> 'spedito' come prima; con storia resta com'e';
//  - annullato -> tornano gli id, li tratta segnaAnnullatiShopify.
// La corsa con l'annullo la chiude il riconoscimento: una lettura vecchia mostra ancora la nostra
// evasione morta, che resta morta. Un tetto di righe e di tempo per giro, prima le piu' recenti; una
// lettura che fallisce lascia quelle righe come sono, e torna quante sono (`nonVerificate`).
// «USCITO DAGLI APERTI» SOLO CON LA LISTA COMPLETA, E LO CONFERMA L'ORDINE. Oltre il tetto delle 30
// pagine mancano dalla lista gli ordini piu' vecchi della finestra, ancora aperti: presi per usciti,
// diventavano 'spedito' senza essere mai partiti ne' evasi (e' il falso che la regola di prima evitava col
// flag `completa`). Quindi un ordine assente si rilegge solo se la lista e' completa, e anche allora
// conta come uscito solo se Shopify lo da' chiuso (`closed`, archiviato): un ordine ancora aperto non si
// chiude perche' e' mancato alla lista per qualunque motivo.
const PER_ID_RIGHE_MAX = 200
const PER_ID_TEMPO_MS = 20000
const PER_ID_A_CHIAMATA = 25
async function allineaEvasiShopify(db: any, integr: any, shop: string, token: string, ordini: any[], completa: boolean, daISO: string, aISO: string): Promise<{ annullati: string[]; nonVerificate: number }> {
  const aperti = new Map<string, any>(ordini.map((o: any) => [String(o.legacyResourceId), o]))
  const righe: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await db.from('ordini_ecommerce').select('id,ordine_esterno_id,fulfillment_stato')
      .eq('integrazione_id', integr.id).eq('stato', 'da_spedire').is('spedizione_id', null).is('unito_in', null)
      .gte('raw->>createdAt', daISO).lte('raw->>createdAt', aISO)   // stessa finestra della lettura (data ordine): un ordine fuori finestra non e' "sparito", non l'abbiamo chiesto
      .order('created_at', { ascending: false }).order('id').range(da, da + 999)
    if (error) throw new Error(error.message)
    righe.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  const daLeggere = righe.filter((r: any) => {
    const o = aperti.get(String(r.ordine_esterno_id))
    return o ? String(o.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED' : completa
  }).slice(0, PER_ID_RIGHE_MAX)
  if (!daLeggere.length) return { annullati: [], nonVerificate: 0 }

  const ids = Array.from(new Set(daLeggere.map((r: any) => String(r.ordine_esterno_id))))
  const letti = new Map<string, any>()   // id esterno -> ordine (null = Shopify non lo restituisce)
  const nonLetti = new Set<string>()     // lettura fallita: quelle righe non cambiano
  const scadenza = Date.now() + PER_ID_TEMPO_MS
  for (let i = 0; i < ids.length && Date.now() < scadenza; i += PER_ID_A_CHIAMATA) {
    const blocco = ids.slice(i, i + PER_ID_A_CHIAMATA)
    try {
      const d: any = await shopifyGraphQL(shop, token,
        `query($ids: [ID!]!){ nodes(ids: $ids){ ... on Order { legacyResourceId cancelledAt closed displayFulfillmentStatus fulfillments(first: 10){ status trackingInfo{ number url } } } } }`,
        { ids: blocco.map(id => `gid://shopify/Order/${id}`) })
      const nodi = d?.nodes || []
      blocco.forEach((id, k) => letti.set(id, nodi[k]?.legacyResourceId ? nodi[k] : null))
    } catch (e: any) {
      blocco.forEach(id => nonLetti.add(id))
      console.error('[SHOPIFY SYNC] lettura per id (quelle righe non cambiano):', integr.id, String(e?.message || e).slice(0, 200))
    }
  }

  // Le evasioni si riconoscono come nostre leggendo le spedizioni del cliente col client di SERVIZIO. La
  // sync del portale gira con la sessione del cliente, e un permesso che manca su quelle colonne (o un
  // errore momentaneo) bloccava tutto il giro: gli ordini evasi dal negoziante restavano «Da spedire»,
  // pronti per un'altra etichetta. Il perimetro non cambia: e' il cliente dell'integrazione, che chi
  // chiama ha gia' letto per QUEL cliente.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const servizio = createAdminSupabase()
  let nonVerificate = daLeggere.filter((r: any) => nonLetti.has(String(r.ordine_esterno_id))).length
  const annullati: string[] = []
  const spediti: string[] = []
  const daAnnullare: string[] = []
  for (const r of daLeggere) {
    const id = String(r.ordine_esterno_id)
    if (!letti.has(id)) continue
    const ord = letti.get(id)
    const evasioni = ord?.fulfillments || []
    let cls: ClassificaEvasioni | null = null
    if (ord) {
      // Un errore su una riga lascia com'e' QUELLA riga, non tutte le altre del giro.
      try { cls = classificaEvasioni(evasioni, await evasioniNostre(servizio, integr.cliente_id, evasioni)) }
      catch (e: any) {
        nonVerificate++
        console.error('[SHOPIFY SYNC] evasioni non riconosciute (la riga non cambia):', integr.id, String(e?.message || e).slice(0, 200))
        continue
      }
    }
    const traccia = ESITI_EVASIONE.includes(String(r.fulfillment_stato || ''))
    const conStoria = traccia || r.fulfillment_stato === 'annullato' || !!cls?.storia
    const st = statoDaShopify(fotoOrdine(ord, cls), { conStoria, assente: !!ord?.closed })
    if (st === 'annullato') annullati.push(id)
    else if (st === 'spedito') spediti.push(r.id)
    else if (cls?.morte.length && !traccia) daAnnullare.push(r.id)
  }
  // Le guardie stanno NELLA scrittura: solo righe ancora 'da_spedire' e senza spedizione (nel frattempo
  // il cliente puo' averle spedite).
  for (let i = 0; i < spediti.length; i += 200) {
    const { error } = await db.from('ordini_ecommerce').update({ stato: 'spedito' })
      .eq('integrazione_id', integr.id).in('id', spediti.slice(i, i + 200)).eq('stato', 'da_spedire').is('spedizione_id', null)
    if (error) throw new Error(error.message)
  }
  for (let i = 0; i < daAnnullare.length; i += 200) {
    const { error } = await db.from('ordini_ecommerce')
      .update({ fulfillment_stato: 'errore', fulfillment_errore: `${PREFISSO_ANNULLO}: su Shopify l'ordine ha ancora l'evasione col tracking di una spedizione annullata`, fulfillment_tentativi: 0 })
      .eq('integrazione_id', integr.id).in('id', daAnnullare.slice(i, i + 200)).eq('stato', 'da_spedire').is('spedizione_id', null).is('unito_in', null)
    if (error) throw new Error(error.message)
  }
  return { annullati, nonVerificate }
}

// GLI ORDINI ANNULLATI SUL NEGOZIO, come WooCommerce e PrestaShop: 'annullato', «Annullato sul
// negozio» in pagina e fuori dall'invio di massa. Le guardie stanno nella scrittura.
//  a. 'da_spedire' senza spedizione e non capofila di un pacco -> 'annullato';
//  b. 'spedito' senza spedizione e senza un'evasione nostra -> 'annullato': sono le righe che la
//     regola di prima aveva chiuso 'spedito' perche' sparite dagli aperti;
//  c. assorbiti e capofila di un pacco non ancora partito -> solo stato_pagamento 'cancelled': restano
//     uniti, e il pacco lascia fuori la loro merce (lib/ordini-uniti). Chiudere un capofila lascerebbe
//     ferma la merce degli altri ordini senza che niente lo dica. Ma e' capofila DI UN PACCO solo se nel
//     pacco resta merce valida d'altri: assorbiti senza spedizione propria e non annullati sul negozio,
//     ne' prima ne' in questo stesso giro. Un capofila coi suoi assorbiti tutti annullati (o spediti a
//     parte) resterebbe «Da spedire» con un pacco vuoto, e «Spedisci selezionati» gli comprerebbe
//     un'etichetta addebitata per un pacco senza merce: e' un ordine da solo, e va in (a) o (b);
//  d. righe con la nostra spedizione e assorbiti di un pacco gia' partito -> 'annullato_store' col
//     testo del badge: l'etichetta c'e', e il negoziante deve vederlo. Se il pacco porta anche la merce
//     di altri ordini validi (un assorbito, o un capofila con assorbiti validi) il testo non dice di
//     annullare la spedizione: fermerebbe anche loro (lib/shopify, testoAnnullatoStore).
// Torna quante righe sono passate ad 'annullato' (a + b): la pagina lo dice dopo la sincronizzazione.
async function segnaAnnullatiShopify(db: any, integr: any, idsEsterni: string[]): Promise<number> {
  if (!idsEsterni.length) return 0
  const righe: any[] = []
  for (let i = 0; i < idsEsterni.length; i += 200) {
    const { data, error } = await db.from('ordini_ecommerce').select('id,ordine_esterno_id,stato,stato_pagamento,spedizione_id,unito_in,fulfillment_stato')
      .eq('integrazione_id', integr.id).in('ordine_esterno_id', idsEsterni.slice(i, i + 200))
    if (error) throw new Error(error.message)
    righe.push(...(data || []))
  }
  if (!righe.length) return 0
  const perCapo = await assorbitiDi(db, righe.map((r: any) => String(r.id)), 'id,unito_in,created_at,spedizione_id,stato_pagamento')
  // Le righe lette qui sono annullate sul negozio, ma il loro stato_pagamento diventa 'cancelled' solo
  // con le scritture in fondo: per sapere chi resta nel pacco contano gia' adesso come annullate.
  const annullateOra = new Set(righe.map((r: any) => String(r.id)))
  // Lo stesso insieme decide due cose: chi resta capofila (c) e il testo del badge di un pacco partito (d).
  const capiConPacco = new Set(Array.from(perCapo)
    .filter(([, loro]) => assorbitiNelPacco(loro, { daSpedire: true }).some((a: any) => !annullateOra.has(String(a.id))))
    .map(([id]) => id))
  const unite = righe.filter((r: any) => r.unito_in && !r.spedizione_id)
  const pacco = unite.length ? await spedizioneDelPacco(db, unite) : new Map<string, string | null>()

  const daAnnullare: string[] = [], speditiDaAnnullare: string[] = [], soloPagamento: string[] = [], conBadge: string[] = [], conBadgeNelPacco: string[] = [], unitiConBadge: string[] = []
  for (const r of righe) {
    if (r.stato === 'annullato') continue
    if (r.spedizione_id) { if (r.fulfillment_stato !== 'annullato_store') (capiConPacco.has(String(r.id)) ? conBadgeNelPacco : conBadge).push(r.id); continue }
    if (r.unito_in) {
      if (pacco.get(String(r.id))) { if (r.fulfillment_stato !== 'annullato_store') unitiConBadge.push(r.id) }
      else if (r.stato_pagamento !== 'cancelled') soloPagamento.push(r.id)
      continue
    }
    if (capiConPacco.has(String(r.id))) { if (r.stato_pagamento !== 'cancelled') soloPagamento.push(r.id); continue }
    if (r.stato === 'da_spedire') daAnnullare.push(r.id)
    else if (r.stato === 'spedito' && !r.fulfillment_stato) speditiDaAnnullare.push(r.id)
  }
  const scrivi = async (ids: string[], patch: any, guardia: (q: any) => any): Promise<number> => {
    let n = 0
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await guardia(db.from('ordini_ecommerce').update(patch).eq('integrazione_id', integr.id).in('id', ids.slice(i, i + 200))).select('id')
      if (error) throw new Error(error.message)
      n += (data || []).length
    }
    return n
  }
  let annullati = 0
  annullati += await scrivi(daAnnullare, { stato: 'annullato', stato_pagamento: 'cancelled' },
    q => q.eq('stato', 'da_spedire').is('spedizione_id', null).is('unito_in', null))
  annullati += await scrivi(speditiDaAnnullare, { stato: 'annullato', stato_pagamento: 'cancelled' },
    q => q.eq('stato', 'spedito').is('spedizione_id', null).is('unito_in', null).is('fulfillment_stato', null))
  await scrivi(soloPagamento, { stato_pagamento: 'cancelled' }, q => q.is('spedizione_id', null))
  await scrivi(conBadge, { fulfillment_stato: 'annullato_store', fulfillment_errore: testoAnnullatoStore(false), stato_pagamento: 'cancelled' },
    q => q.not('spedizione_id', 'is', null))
  await scrivi(conBadgeNelPacco, { fulfillment_stato: 'annullato_store', fulfillment_errore: testoAnnullatoStore(true), stato_pagamento: 'cancelled' },
    q => q.not('spedizione_id', 'is', null))
  await scrivi(unitiConBadge, { fulfillment_stato: 'annullato_store', fulfillment_errore: testoAnnullatoStore(true), stato_pagamento: 'cancelled' },
    q => q.is('spedizione_id', null).not('unito_in', 'is', null))
  return annullati
}

// Conta, tra gli ordini appena sincronizzati (per id esterno), quanti sono 'spedito' e quanti 'da_spedire'
// leggendo lo stato reale dal DB. Condiviso: serve al messaggio "X già spediti · Y da spedire".
export async function contaStatiSincronizzati(db: any, integrazioneId: string, idsEsterni: string[]): Promise<{ spediti: number; daSpedire: number }> {
  let spediti = 0, daSpedire = 0
  for (let i = 0; i < idsEsterni.length; i += 100) {
    const chunk = idsEsterni.slice(i, i + 100)
    const { data } = await db.from('ordini_ecommerce').select('stato').eq('integrazione_id', integrazioneId).in('ordine_esterno_id', chunk)
    for (const r of (data || [])) { if ((r as any).stato === 'spedito') spediti++; else daSpedire++ }
  }
  return { spediti, daSpedire }
}
