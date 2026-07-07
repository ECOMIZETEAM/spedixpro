import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { getValidShopifyToken, shopifyGraphQL } from '@/lib/shopify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono sincronizzare' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const integrazioneId = body.integrazione_id
  if (!integrazioneId) return NextResponse.json({ error: 'integrazione_id mancante' }, { status: 400 })

  // Recupera l'integrazione (deve essere del cliente loggato)
  const { data: integr } = await supabase
    .from('integrazioni').select('*')
    .eq('id', integrazioneId).eq('cliente_id', utente.cliente_id).eq('piattaforma', 'shopify')
    .maybeSingle()
  if (!integr) return NextResponse.json({ error: 'Integrazione non trovata' }, { status: 404 })

  const cred = integr.credenziali as any
  const shop = cred?.shop
  // Ottiene un token valido (rifresca automaticamente se scaduto - token expiring)
  const tk = await getValidShopifyToken(integr)
  if (tk.error || !tk.token) return NextResponse.json({ error: tk.error || 'Token non disponibile' }, { status: 400 })
  const token = tk.token
  if (!shop) return NextResponse.json({ error: 'Credenziali Shopify mancanti' }, { status: 400 })

  // Legge ordini NON evasi da Shopify via GraphQL Admin API (con immagini inline).
  // Paginazione fino a ~300 ordini per sync.
  const ordini: any[] = []
  try {
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
  } catch (e: any) {
    return NextResponse.json({ error: 'Errore chiamata Shopify: ' + (e?.message || e) }, { status: 502 })
  }

  // Mappa e salva (upsert per non duplicare)
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
      cliente_id: utente.cliente_id,
      master_id: utente.master_id,
      integrazione_id: integrazioneId,
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
    const { error } = await supabase.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id',
      ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  // Aggiorna stato integrazione
  await supabase.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length })
    .eq('id', integrazioneId)

  return NextResponse.json({ ok: true, letti: ordini.length, importati })
}
