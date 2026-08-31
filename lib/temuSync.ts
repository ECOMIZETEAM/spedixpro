import { getValidTemuToken, temuRequest } from '@/lib/temu'

// Sincronizza gli ordini Temu da spedire in ordini_ecommerce.
// NB: nomi API/campi ("bg.order.list.get") da confermare sui doc partner Temu una volta approvata l'app.
export async function sincronizzaOrdiniTemu(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const token = await getValidTemuToken(db, integr)

  // Ordini in attesa di spedizione, PAGINATI (status/parametri da adattare ai doc Temu). Prima si leggeva
  // SOLO la pagina 1 (max 50): gli ordini oltre il 50° si PERDEVANO. Ora scorro le pagine finche' ne
  // tornano di piene, con dedup di sicurezza: se l'API ignorasse page_number (ritornando sempre la 1a),
  // la 2a pagina non porta ordini NUOVI e il ciclo si ferma (niente doppioni ne' loop infinito).
  const PAGE = 50
  const lista: any[] = []
  const vistiTemu = new Set<string>()
  for (let page = 1; page <= 40; page++) {
    const resp = await temuRequest('bg.order.list.get', {
      page_size: PAGE, page_number: page,
      order_status: 'PENDING',   // "da spedire"
    }, token)
    const batch: any[] = resp?.order_list || resp?.result?.order_list || resp?.data?.orders || []
    const nuovi = batch.filter((o: any) => {
      const id = String(o.order_sn || o.order_id || o.parent_order_sn || o.id)
      if (!id || vistiTemu.has(id)) return false
      vistiTemu.add(id); return true
    })
    lista.push(...nuovi)
    if (batch.length < PAGE || nuovi.length === 0) break
  }
  let importati = 0
  for (const o of lista) {
    const addr = o.receipt_address || o.recipient_address || o.shipping_address || {}
    const destinatario = {
      nome: addr.receiver_name || addr.name || '',
      indirizzo: [addr.address_line1, addr.address_line2, addr.detail_address].filter(Boolean).join(' ') || addr.full_address || '',
      citta: addr.city || '',
      provincia: addr.state || addr.province || '',
      cap: addr.post_code || addr.postal_code || addr.zipcode || '',
      paese: addr.country_code || addr.region_code || 'IT',
      // Temu spesso NON fornisce l'email compratore: placeholder valido per non far fallire l'etichetta
      // dei corrieri con email obbligatoria (es. SpediamoPro/Poste). Il tracking al cliente lo fa il
      // nostro sistema (SMS/link /traccia), non l'email del corriere.
      email: addr.email || 'noreply@moovexpress.com',
      telefono: addr.phone || addr.mobile || '',
    }
    const articoli = (o.order_item_list || o.items || o.line_items || []).map((li: any) => ({
      nome: li.goods_name || li.product_name || li.title || '',
      quantita: li.quantity || li.goods_number || 1, grammi: 0,
      sku: li.sku || li.sku_id || li.goods_id || '',
      immagine: li.thumb_url || li.image || null,
      lineItemId: li.order_item_id || li.id || null,
    }))
    const ordineId = String(o.order_sn || o.order_id || o.parent_order_sn || o.id)
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      piattaforma: 'temu',
      ordine_esterno_id: ordineId,
      numero_ordine: `#${ordineId}`,
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: o.order_amount ? Number(o.order_amount) : null,
      valuta: o.currency || 'EUR',
      stato_pagamento: o.order_status || '',
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
