import { getValidEbayToken, ebayGet } from '@/lib/ebay'

// Sincronizza gli ordini eBay non ancora evasi in ordini_ecommerce.
export async function sincronizzaOrdiniEbay(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const token = await getValidEbayToken(db, integr)
  // ordini da evadere: orderfulfillmentstatus {NOT_STARTED | IN_PROGRESS}.
  // PAGINAZIONE: prima si prendeva solo la 1ª pagina (limit=50) → chi aveva più di 50 ordini da
  // evadere ne perdeva. Ora si scorre a pagine da 200 (max eBay) finché ci sono ordini.
  const ordini: any[] = []
  const LIMIT = 200
  for (let offset = 0; offset < 5000; offset += LIMIT) {
    const data = await ebayGet(token, `/sell/fulfillment/v1/order?filter=orderfulfillmentstatus:%7BNOT_STARTED%7CIN_PROGRESS%7D&limit=${LIMIT}&offset=${offset}`)
    const batch: any[] = data?.orders || []
    ordini.push(...batch)
    const total = Number(data?.total || 0)
    if (batch.length < LIMIT || (total && offset + LIMIT >= total)) break
  }

  let importati = 0
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
  }

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length })
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
