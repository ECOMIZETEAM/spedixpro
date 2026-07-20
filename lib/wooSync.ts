import { wooGet } from '@/lib/woo'

// Sincronizza gli ordini WooCommerce "da spedire" (status=processing) in ordini_ecommerce.
export async function sincronizzaOrdiniWoo(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const url = cred?.url, ck = cred?.ck, cs = cred?.cs
  if (!url || !ck || !cs) throw new Error('Credenziali WooCommerce mancanti')

  // Ordini "da spedire" = non ancora evasi. Prima si prendeva SOLO 'processing' (pagato-da-spedire)
  // e solo 3 pagine (max 300): si perdevano sia gli ordini oltre i 300, sia quelli in altri stati
  // non-evasi (es. 'on-hold' = bonifico/COD in attesa, che molti negozi spediscono comunque).
  // Ora: stati processing+on-hold, paginazione completa (tetto di sicurezza 50 pagine).
  const ordini: any[] = []
  for (let page = 1; page <= 50; page++) {
    const batch = await wooGet(url, ck, cs, `/orders?status=processing,on-hold&per_page=100&page=${page}&orderby=date&order=desc`)
    if (!Array.isArray(batch) || !batch.length) break
    ordini.push(...batch)
    if (batch.length < 100) break
  }

  let importati = 0
  for (const o of ordini) {
    const sh = o.shipping || {}
    const bi = o.billing || {}
    const src = sh.address_1 ? sh : bi   // usa spedizione se presente, altrimenti fatturazione
    const destinatario = {
      nome: `${src.first_name || ''} ${src.last_name || ''}`.trim() || `${bi.first_name || ''} ${bi.last_name || ''}`.trim(),
      indirizzo: [src.address_1, src.address_2].filter(Boolean).join(' '),
      citta: src.city || '',
      provincia: src.state || '',
      cap: src.postcode || '',
      paese: src.country || 'IT',
      email: bi.email || '',
      telefono: src.phone || bi.phone || '',
    }
    const articoli = (o.line_items || []).map((li: any) => ({
      nome: li.name, quantita: li.quantity, grammi: 0, sku: li.sku || '', immagine: li.image?.src || null,
    }))
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      piattaforma: 'woocommerce',
      ordine_esterno_id: String(o.id),
      numero_ordine: o.number ? `#${o.number}` : String(o.id),
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: o.total ? Number(o.total) : null,
      valuta: o.currency || 'EUR',
      stato_pagamento: o.status || '',
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
