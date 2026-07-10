import { getValidTiktokToken, tiktokRequest } from '@/lib/tiktok'

// Sincronizza gli ordini TikTok Shop da spedire (AWAITING_SHIPMENT) in ordini_ecommerce.
export async function sincronizzaOrdiniTiktok(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const token = await getValidTiktokToken(db, integr)
  const cred = (integr.credenziali || {}) as any
  const shopCipher = cred.shop_cipher
  if (!shopCipher) throw new Error('TikTok: shop non autorizzato, ricollega il negozio')

  // 1) Cerco gli ordini da evadere
  const search = await tiktokRequest('POST', '/order/202309/orders/search', {
    token, shopCipher,
    query: { page_size: 50, sort_field: 'create_time', sort_order: 'DESC' },
    body: { order_status: 'AWAITING_SHIPMENT' },
  })
  const lista: any[] = search?.data?.orders || []
  if (!lista.length) {
    await db.from('integrazioni').update({ ultimo_sync: new Date().toISOString(), ordini_totali: 0, errore: null, stato: 'attivo' }).eq('id', integr.id)
    return { letti: 0, importati: 0 }
  }

  // 2) Dettaglio ordini (indirizzo destinatario + line items completi)
  const ids = lista.map(o => o.id).filter(Boolean)
  let dettagli: any[] = lista
  try {
    const det = await tiktokRequest('GET', '/order/202309/orders', { token, shopCipher, query: { ids: ids.join(',') } })
    if (det?.data?.orders?.length) dettagli = det.data.orders
  } catch { /* uso i dati della search */ }

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
      email: '',
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
      piattaforma: 'tiktok',
      ordine_esterno_id: String(o.id),
      numero_ordine: `#${o.id}`,
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale,
      valuta: o.payment?.currency || 'EUR',
      stato_pagamento: o.status || '',
      raw: o,
    }
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: lista.length, errore: null, stato: 'attivo' })
    .eq('id', integr.id)

  return { letti: lista.length, importati }
}
