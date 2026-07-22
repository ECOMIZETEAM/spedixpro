import { getValidEbayToken, ebayGet } from '@/lib/ebay'

// Giorno italiano -> ISO UTC per i filtri data dei marketplace (con margine orario: gli ordini sono
// timestampati in UTC, il giorno "italiano" parte ~2h prima in UTC d'estate, 1h d'inverno).
export function rangeGiorniISO(dal?: string | null, al?: string | null, defaultGiorni = 30): { daISO: string; aISO: string } {
  const oggi = new Date().toISOString().slice(0, 10)
  const d = (dal || '').match(/^\d{4}-\d{2}-\d{2}$/) ? dal! : new Date(Date.now() - defaultGiorni * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const a = (al || '').match(/^\d{4}-\d{2}-\d{2}$/) ? al! : oggi
  // CLAMP a "adesso": con al=oggi il fine-finestra (23:59+margine) cadrebbe nel FUTURO e eBay
  // rifiuta con 400 "The start and end dates can't be in the future".
  const now = Date.now()
  let dMs = new Date(d + 'T00:00:00Z').getTime() - 2 * 3600 * 1000
  let aMs = new Date(a + 'T23:59:59Z').getTime() + 2 * 3600 * 1000
  if (aMs > now) aMs = now
  if (dMs >= aMs) dMs = aMs - 60 * 1000
  return { daISO: new Date(dMs).toISOString(), aISO: new Date(aMs).toISOString() }
}

// Sincronizza gli ordini eBay in ordini_ecommerce (spediti e non, qualunque pagamento, contrassegno
// incluso) NELLA FINESTRA DATE RICHIESTA: si importa SOLO l'intervallo selezionato in pagina
// (oggi -> solo oggi; ieri -> solo ieri; il mese -> il mese). Default: ultimi 30 giorni.
export async function sincronizzaOrdiniEbay(db: any, integr: any, range?: { dal?: string | null; al?: string | null }): Promise<{ letti: number; importati: number }> {
  const token = await getValidEbayToken(db, integr)
  const ordini: any[] = []
  const LIMIT = 200
  const { daISO, aISO } = rangeGiorniISO(range?.dal, range?.al)
  // Nessun filtro di stato/pagamento (spediti E non, contrassegno incluso): SOLO la finestra data.
  // Niente fallback "senza data": importare tutto lo storico a prescindere non è mai desiderato.
  const filtro = `creationdate:[${daISO}..${aISO}]`
  let totApi = 0
  for (let offset = 0; offset < 10000; offset += LIMIT) {
    const data: any = await ebayGet(token, `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filtro)}&limit=${LIMIT}&offset=${offset}`)
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
  console.log(`[EBAY SYNC] cliente=${integr.cliente_id} negozio="${integr.nome_negozio}" apiTotal=${totApi} letti=${ordini.length} salvati=${importati} errori=${errori} finestra=${daISO.slice(0, 10)}..${aISO.slice(0, 10)}`)

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length })
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
