import { getValidEbayToken, ebayGet } from '@/lib/ebay'

// Sincronizza TUTTI gli ordini eBay in ordini_ecommerce (spediti e non, qualunque pagamento).
export async function sincronizzaOrdiniEbay(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const token = await getValidEbayToken(db, integr)
  // Prende TUTTO: nessun filtro di stato/pagamento (contrassegno incluso). Solo finestra data (ultimi
  // 180 gg) per non scaricare anni di storico. Paginazione completa (pagine da 200, max eBay). Gli
  // ordini già evasi su eBay vengono marcati 'spedito' (sotto), gli altri restano da spedire.
  const ordini: any[] = []
  const LIMIT = 200
  const daISO = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  const aISO = new Date().toISOString()
  // TUTTI gli ordini (spediti E non spediti, qualsiasi pagamento, contrassegno incluso): NESSUN filtro
  // di stato/pagamento. Solo la finestra data (ultimi 180 gg) per non prendere anni di storico.
  let filtro = `creationdate:[${daISO}..${aISO}]`
  let fallback = false
  let totApi = 0
  for (let offset = 0; offset < 10000; offset += LIMIT) {
    const qFiltro = filtro ? `filter=${encodeURIComponent(filtro)}&` : ''
    let data: any
    try {
      data = await ebayGet(token, `/sell/fulfillment/v1/order?${qFiltro}limit=${LIMIT}&offset=${offset}`)
    } catch (e: any) {
      // eBay ha rifiutato il filtro data (range non ammesso?): riprovo SENZA filtro (default eBay),
      // così il sync non fallisce e prende comunque gli ordini.
      if (offset === 0 && !fallback) { fallback = true; filtro = ''; offset = -LIMIT; continue }
      throw e
    }
    const batch: any[] = data?.orders || []
    ordini.push(...batch)
    totApi = Number(data?.total || totApi)
    if (batch.length < LIMIT || (totApi && offset + LIMIT >= totApi)) break
  }

  let importati = 0, errori = 0
  for (const o of ordini) {
    const shipTo = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || {}
    const addr = shipTo.contactAddress || {}
    const destinatario = {
      nome: shipTo.fullName || '',
      indirizzo: [addr.addressLine1, addr.addressLine2].filter(Boolean).join(' '),
      citta: addr.city || '',
      provincia: addr.stateOrProvince || '',
      cap: addr.postalCode || '',
      paese: addr.countryCode || 'IT',
      email: shipTo.email || o.buyer?.buyerRegistrationAddress?.email || '',
      telefono: shipTo.primaryPhone?.phoneNumber || '',
    }
    const articoli = (o.lineItems || []).map((li: any) => ({
      nome: li.title, quantita: li.quantity || 1, grammi: 0, sku: li.sku || '',
      immagine: li.image?.imageUrl || null, lineItemId: li.lineItemId,
    }))
    const money = o.pricingSummary?.total
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      piattaforma: 'ebay',
      ordine_esterno_id: String(o.orderId),
      numero_ordine: o.legacyOrderId ? `#${o.legacyOrderId}` : String(o.orderId),
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: money?.value ? Number(money.value) : null,
      valuta: money?.currency || 'EUR',
      stato_pagamento: o.orderPaymentStatus || '',
      raw: o,
    }
    // Già evaso su eBay → lo marchiamo 'spedito' così NON compare tra i "da spedire". Gli ordini non
    // evasi NON toccano lo stato (nuovo = default 'da_spedire'; esistente = mantiene il suo, così non
    // riportiamo a "da spedire" un ordine già spedito da MoovExpress).
    if (o.orderFulfillmentStatus === 'FULFILLED') payload.stato = 'spedito'
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
    else { errori++; console.error('[EBAY SYNC] upsert KO ordine', o.orderId, '-', error.message) }
  }

  // LOG DIAGNOSTICO: quanti ne dichiara l'API (total) vs quanti letti (paginati) vs salvati vs errori.
  // Se apiTotal > letti → problema di fetch/finestra; se letti > salvati → upsert che falliscono.
  console.log(`[EBAY SYNC] cliente=${integr.cliente_id} negozio="${integr.nome_negozio}" apiTotal=${totApi} letti=${ordini.length} salvati=${importati} errori=${errori} finestra=${fallback ? 'SENZA-data(fallback)' : daISO.slice(0, 10) + '..oggi'}`)

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length })
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
