import { getValidTiktokToken, tiktokRequest } from '@/lib/tiktok'
import { contaStatiSincronizzati } from '@/lib/shopifySync'

// Sincronizza gli ordini TikTok Shop da spedire (AWAITING_SHIPMENT) in ordini_ecommerce.
export async function sincronizzaOrdiniTiktok(db: any, integr: any): Promise<{ letti: number; importati: number; spediti: number; daSpedire: number }> {
  const token = await getValidTiktokToken(db, integr)
  const cred = (integr.credenziali || {}) as any
  const shopCipher = cred.shop_cipher
  if (!shopCipher) throw new Error('TikTok: shop non autorizzato, ricollega il negozio')

  // 1) Cerco gli ordini da evadere, PAGINATI. Prima si leggeva SOLO la 1a pagina (max 50): gli ordini
  // oltre il 50° si PERDEVANO. Ora scorro con next_page_token, con dedup di sicurezza (se il token non
  // avanzasse, il ciclo si ferma senza doppioni ne' loop).
  const lista: any[] = []
  const vistiTk = new Set<string>()
  let pageToken = ''
  for (let page = 0; page < 40; page++) {
    const query: any = { page_size: 50, sort_field: 'create_time', sort_order: 'DESC' }
    if (pageToken) query.page_token = pageToken
    const search = await tiktokRequest('POST', '/order/202309/orders/search', {
      token, shopCipher, query, body: { order_status: 'AWAITING_SHIPMENT' },
    })
    const batch: any[] = search?.data?.orders || []
    const nuovi = batch.filter((o: any) => { const id = String(o.id || ''); if (!id || vistiTk.has(id)) return false; vistiTk.add(id); return true })
    lista.push(...nuovi)
    pageToken = search?.data?.next_page_token || ''
    if (!pageToken || nuovi.length === 0) break
  }
  if (!lista.length) {
    await db.from('integrazioni').update({ ultimo_sync: new Date().toISOString(), ordini_totali: 0, errore: null, stato: 'attivo' }).eq('id', integr.id)
    return { letti: 0, importati: 0, spediti: 0, daSpedire: 0 }
  }

  // 2) Dettaglio ordini (indirizzo destinatario + line items completi). L'endpoint ha un tetto di ids per
  // chiamata: li richiedo a BLOCCHI di 50 (una sola chiamata con TUTTI gli id troncava i dettagli oltre
  // il primo blocco quando gli ordini superano la cinquantina).
  const ids = lista.map(o => o.id).filter(Boolean)
  let dettagli: any[] = lista
  try {
    const acc: any[] = []
    for (let i = 0; i < ids.length; i += 50) {
      const det = await tiktokRequest('GET', '/order/202309/orders', { token, shopCipher, query: { ids: ids.slice(i, i + 50).join(',') } })
      if (det?.data?.orders?.length) acc.push(...det.data.orders)
    }
    if (acc.length) dettagli = acc
  } catch { /* uso i dati della search */ }

  // SOLO GLI ORDINI CHE SPEDISCE IL VENDITORE. shipping_type (Get Order Detail) dice chi porta il pacco:
  // 'SELLER' il venditore col suo corriere, 'TIKTOK' il servizio di TikTok, con l'etichetta da prendere su
  // TikTok, 'TIKTOK_DIGITAL' niente da spedire. Fino al 4/11/2026 si importavano tutti gli ordini da spedire:
  // un ordine con la spedizione di TikTok sarebbe partito anche col nostro corriere, pagato due volte, e il
  // tracking non lo si potrebbe nemmeno rimandare (Mark Package As Shipped vale solo per i propri corrieri).
  // Un ordine senza il campo si tiene: e' il formato vecchio, in cui c'era solo la spedizione del venditore.
  const spedisceIlVenditore = (o: any) =>
    (!o.shipping_type || o.shipping_type === 'SELLER') && (!o.fulfillment_type || o.fulfillment_type === 'FULFILLMENT_BY_SELLER')
  const primaDelFiltro = dettagli.length
  dettagli = dettagli.filter(spedisceIlVenditore)
  if (dettagli.length < primaDelFiltro) console.warn('[TIKTOK][SYNC] ordini spediti da TikTok, non importati:', primaDelFiltro - dettagli.length, integr.identificativo)

  let importati = 0
  for (const o of dettagli) {
    const addr = o.recipient_address || {}
    // district_info: array {address_level_name, address_name} (region/state/city/district)
    const parti = (addr.district_info || []).reduce((acc: any, d: any) => {
      const lvl = (d.address_level_name || '').toLowerCase()
      if (lvl.includes('state') || lvl.includes('province') || lvl.includes('region')) acc.provincia = d.address_name
      else if (lvl.includes('city')) acc.citta = d.address_name
      return acc
    }, {})
    const destinatario = {
      nome: addr.name || '',
      indirizzo: addr.full_address || addr.address_detail || addr.address_line1 || '',
      citta: parti.citta || addr.city || '',
      provincia: parti.provincia || '',
      cap: addr.postal_code || addr.zipcode || '',
      paese: addr.region_code || 'IT',
      // TikTok maschera l'email del compratore (non la espone): placeholder valido per non far fallire
      // l'etichetta dei corrieri con email obbligatoria. Il tracking al cliente lo fa il nostro sistema.
      email: addr.email || 'noreply@moovexpress.com',
      telefono: addr.phone_number || '',
    }
    const articoli = (o.line_items || []).map((li: any) => ({
      nome: li.product_name || li.sku_name || '', quantita: 1, grammi: 0,
      sku: li.seller_sku || li.sku_id || '', immagine: li.sku_image || null,
      lineItemId: li.id,
    }))
    const totale = o.payment?.total_amount ? Number(o.payment.total_amount) : null
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      // Dominio del negozio SULLA riga: i redact GDPR filtrano su questo. Non su integrazione_id,
      // che sparisce se qualcuno cancella l'integrazione e lascia gli ordini orfani — e un ordine
      // orfano nessuna cancellazione lo raggiunge piu' (erano 4.147 il 9/09/2026).
      shop: integr.identificativo,
      piattaforma: 'tiktok',
      ordine_esterno_id: String(o.id),
      numero_ordine: `#${o.id}`,
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale,
      valuta: o.payment?.currency || 'EUR',
      stato_pagamento: o.status || '',
      // CONTRASSEGNO = SOLDI. TikTok lo dice con is_cod, che lib/ordini-uniti non legge: guarda il metodo di
      // pagamento in raw.payment_method (COLONNE_PAGAMENTO), e un ordine in contrassegno senza quel campo
      // risulterebbe prepagato, con niente da incassare alla consegna. Lo si scrive li', col nome del metodo
      // che TikTok mostra quando non e' contrassegno.
      raw: { ...o, payment_method: o.is_cod === true ? 'cod' : (o.payment_method_name || undefined) },
    }
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: dettagli.length, errore: null, stato: 'attivo' })
    .eq('id', integr.id)

  const { spediti, daSpedire } = await contaStatiSincronizzati(db, integr.id, dettagli.map((o: any) => String(o.id)))
  return { letti: dettagli.length, importati, spediti, daSpedire }
}
