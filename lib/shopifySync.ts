import { getValidShopifyToken, shopifyGraphQL } from '@/lib/shopify'

// Sincronizza gli ordini non evasi di Shopify in ordini_ecommerce.
// db: client Supabase (user-scoped dal portale, admin dall'app embedded).
// L'integrazione porta con sé cliente_id/master_id: funziona in entrambi i contesti.
export async function sincronizzaOrdiniShopify(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const shop = cred?.shop
  if (!shop) throw new Error('Credenziali Shopify mancanti')
  const tk = await getValidShopifyToken(integr, db)
  if (tk.error || !tk.token) throw new Error(tk.error || 'Token non disponibile')
  const token = tk.token

  // Ordini non evasi via GraphQL (immagini inline), paginati fino a ~300.
  const ordini: any[] = []
  let cursor: string | null = null
  for (let page = 0; page < 3; page++) {
    const data: any = await shopifyGraphQL(shop, token, `
      query($cursor: String){
        orders(first: 100, after: $cursor, query: "status:open fulfillment_status:unfulfilled", sortKey: CREATED_AT){
          edges { node {
            legacyResourceId name email phone displayFinancialStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            shippingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
            lineItems(first: 100){ edges { node { title quantity sku image { url } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { cursor })
    const conn = data?.orders
    for (const e of (conn?.edges || [])) ordini.push(e.node)
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }

  let importati = 0
  for (const o of ordini) {
    const ship = o.shippingAddress || {}
    const destinatario = {
      nome: ship.name || '',
      indirizzo: [ship.address1, ship.address2].filter(Boolean).join(' '),
      citta: ship.city || '',
      provincia: ship.provinceCode || ship.province || '',
      cap: ship.zip || '',
      paese: ship.countryCodeV2 || 'IT',
      email: o.email || '',
      telefono: ship.phone || o.phone || '',
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
