import { getValidShopifyToken, shopifyGraphQL } from '@/lib/shopify'
import { rangeGiorniISO } from '@/lib/ebaySync'

// Sincronizza gli ordini di Shopify in ordini_ecommerce NELLA FINESTRA DATE richiesta (default 30gg).
// db: client Supabase (user-scoped dal portale, admin dall'app embedded).
// L'integrazione porta con sé cliente_id/master_id: funziona in entrambi i contesti.
export async function sincronizzaOrdiniShopify(db: any, integr: any, range?: { dal?: string | null; al?: string | null }): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const shop = cred?.shop
  if (!shop) throw new Error('Credenziali Shopify mancanti')
  const tk = await getValidShopifyToken(integr, db)
  if (tk.error || !tk.token) throw new Error(tk.error || 'Token non disponibile')
  const token = tk.token
  // FINESTRA DATE: si importa SOLO l'intervallo scelto in pagina (oggi -> solo oggi; il mese -> il
  // mese). created_at di Shopify e' un timestamp: uso gli estremi ISO gia' pronti (margine orario).
  const { daISO, aISO } = rangeGiorniISO(range?.dal, range?.al)
  // FILTRO SU updated_at, NON created_at: cosi' una ri-sincronizzazione RIPESCA e AGGIORNA gli ordini
  // MODIFICATI dopo la creazione (destinatario aggiunto dopo, evasione cambiata, indirizzo corretto…),
  // non solo quelli nuovi. Un ordine creato ieri ma cambiato oggi rientra nella finestra "oggi" e si
  // aggiorna. La DATA mostrata in lista resta quella di creazione (createdAt): qui si decide solo COSA
  // ripescare, non cosa visualizzare.
  const filtroData = `updated_at:>=${daISO} updated_at:<=${aISO}`

  // Ordini via GraphQL (immagini inline), i piu' RECENTI prima, paginati fino a ~3000. Prendiamo sia
  // gli EVASI sia i NON evasi (status:open, senza filtro fulfillment): cosi' anche gli ordini gia'
  // evasi su Shopify entrano con la loro DATA e gateway veri (prima, prendendo solo i non-evasi, gli
  // evasi non venivano mai riletti e restavano con la data di IMPORT). Gli evasi li marchiamo spediti.
  const ordini: any[] = []
  let cursor: string | null = null
  let completa = false   // true se abbiamo scaricato TUTTI gli ordini aperti (nessuna pagina troncata)
  // Tetto a 30 pagine (~3000 ordini nella finestra date scelta): prima era 3 (300) e chi aveva piu' di
  // 300 ordini modificati nella finestra ne perdeva una parte. Il flag `completa` resta corretto (true
  // solo se non c'e' piu' pagina), quindi la chiusura degli archiviati non fa falsi positivi.
  for (let page = 0; page < 30; page++) {
    const data: any = await shopifyGraphQL(shop, token, `
      query($cursor: String){
        orders(first: 100, after: $cursor, query: "status:open ${filtroData}", sortKey: UPDATED_AT, reverse: true){
          edges { node {
            legacyResourceId name email phone createdAt updatedAt paymentGatewayNames displayFinancialStatus displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            shippingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
            billingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
            lineItems(first: 100){ edges { node { title quantity sku image { url } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { cursor })
    const conn = data?.orders
    for (const e of (conn?.edges || [])) ordini.push(e.node)
    if (!conn?.pageInfo?.hasNextPage) { completa = true; break }
    cursor = conn.pageInfo.endCursor
  }

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
    const articoli = (o.lineItems?.edges || []).map((e: any) => ({
      nome: e.node.title, quantita: e.node.quantity, grammi: 0, sku: e.node.sku || '',
      immagine: e.node.image?.url || null,
    }))
    const money = o.totalPriceSet?.shopMoney
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      piattaforma: 'shopify',
      ordine_esterno_id: String(o.legacyResourceId),
      numero_ordine: o.name || '',
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: money?.amount ? Number(money.amount) : null,
      valuta: money?.currencyCode || 'EUR',
      stato_pagamento: (o.displayFinancialStatus || '').toLowerCase(),
      raw: o,
    }
    // Gia' evaso su Shopify -> "spedito" (sparisce dal default "da spedire"). Gli ordini NON evasi
    // non toccano lo stato: nuovo = default 'da_spedire'; esistente = mantiene il suo (non riportiamo
    // a "da spedire" un ordine gia' spedito da noi, come per l'altro provider).
    if (String(o.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED') payload.stato = 'spedito'
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  // Ordini che erano DA SPEDIRE ma non sono piu' tra gli ordini APERTI di Shopify (annullati o
  // archiviati la' fuori): li segno "spediti", cosi' non restano bloccati su "da spedire". Gli evasi
  // ora rientrano nella lista e li chiude gia' il ciclo sopra; questo copre gli archiviati/annullati.
  // SOLO se abbiamo la lista COMPLETA (nessuna pagina troncata), altrimenti si rischia il falso.
  if (completa) {
    const vistiIds = new Set(ordini.map((o: any) => String(o.legacyResourceId)))
    const { data: giaDaSpedire } = await db.from('ordini_ecommerce')
      .select('id,ordine_esterno_id')
      .eq('integrazione_id', integr.id).eq('stato', 'da_spedire')
      .gte('raw->>updatedAt', daISO).lte('raw->>updatedAt', aISO)   // finestra su updated_at come il fetch: gli ordini NON toccati non si chiudono per sbaglio
    const daChiudere = (giaDaSpedire || [])
      .filter((r: any) => !vistiIds.has(String(r.ordine_esterno_id)))
      .map((r: any) => r.id)
    if (daChiudere.length) await db.from('ordini_ecommerce').update({ stato: 'spedito' }).in('id', daChiudere)
  }

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length, errore: null })   // sync riuscita: azzera un errore precedente (non piu' appiccicato quando lo store rientra)
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
