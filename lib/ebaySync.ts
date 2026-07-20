import { getValidEbayToken, ebayGet } from '@/lib/ebay'

// Sincronizza gli ordini eBay non ancora evasi in ordini_ecommerce.
export async function sincronizzaOrdiniEbay(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const token = await getValidEbayToken(db, integr)
  // Ordini da evadere. Miglioramenti (in coda 1-2-3):
  //  1) NON pagati inclusi: filtriamo solo per stato di EVASIONE (NOT_STARTED|IN_PROGRESS), non per
  //     pagamento → prende anche gli ordini "in attesa di spedizione" ancora da pagare.
  //  2) FINESTRA TEMPORALE ampia: senza creationdate eBay può limitarsi agli ordini recenti; mettiamo
  //     un range esplicito (ultimi 180 gg) così non sfuggono i non-spediti più vecchi.
  //  3) PAGINAZIONE completa (pagine da 200, max eBay) — prima si fermava a 50.
  const ordini: any[] = []
  const LIMIT = 200
  const daISO = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  const aISO = new Date().toISOString()
  const STATO = 'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}'
  let filtro = `creationdate:[${daISO}..${aISO}],${STATO}`
  let fallback = false
  let totApi = 0
  for (let offset = 0; offset < 10000; offset += LIMIT) {
    let data: any
    try {
      data = await ebayGet(token, `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filtro)}&limit=${LIMIT}&offset=${offset}`)
    } catch (e: any) {
      // eBay ha rifiutato il filtro con la data (range non ammesso?): ripiego sul solo stato di
      // evasione, così il sync non fallisce e prende comunque gli ordini non spediti.
      if (offset === 0 && !fallback) { fallback = true; filtro = STATO; offset = -LIMIT; continue }
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
