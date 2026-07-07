import { API_VERSION } from '@/lib/shopify'

// Info negozio via GraphQL Admin API (allineato al requisito app pubblica).
async function fetchShopInfo(shop: string, token: string) {
  try {
    const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ shop { name email billingAddress { address1 city province provinceCode zip country phone } } }` }),
    })
    const d = await r.json()
    return d?.data?.shop || null
  } catch { return null }
}

// Master di destinazione per i nuovi negozi. Default: root (M1).
// Configurabile con SHOPIFY_ONBOARDING_MASTER_ID (es. quando sarai master "Lorenzo").
async function onboardingMasterId(admin: any): Promise<string | null> {
  const env = process.env.SHOPIFY_ONBOARDING_MASTER_ID
  if (env) return env
  const { data } = await admin.from('masters').select('id').is('parent_master_id', null).limit(1)
  return data?.[0]?.id || null
}

// Listino di default collegato ai nuovi clienti Shopify.
// Priorità: env SHOPIFY_ONBOARDING_LISTINO_ID → "Listino Standard Shopify" del master.
async function onboardingListinoId(admin: any, masterId: string): Promise<string | null> {
  if (process.env.SHOPIFY_ONBOARDING_LISTINO_ID) return process.env.SHOPIFY_ONBOARDING_LISTINO_ID
  const { data } = await admin.from('listini_clienti')
    .select('id').eq('master_id', masterId).eq('attivo', true)
    .ilike('nome', '%standard shopify%').limit(1)
  return data?.[0]?.id || null
}

// Crea (o riusa) un cliente MoovExpress per un negozio Shopify installato dallo store.
// Idempotente: se il negozio è già collegato, ritorna il cliente esistente.
export async function provisionShopifyCliente(
  admin: any, shop: string, token: string
): Promise<{ clienteId: string; masterId: string } | { error: string }> {
  // già collegato?
  const { data: integr } = await admin.from('integrazioni')
    .select('cliente_id,master_id').eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  if (integr?.cliente_id) return { clienteId: integr.cliente_id, masterId: integr.master_id }

  const masterId = await onboardingMasterId(admin)
  if (!masterId) return { error: 'Master di destinazione non trovato' }

  const info = await fetchShopInfo(shop, token)
  const nome = info?.name || shop.replace('.myshopify.com', '')
  const addr = info?.billingAddress || {}

  // codice cliente progressivo per master
  const { data: ultimi } = await admin.from('clienti')
    .select('codice_cliente').eq('master_id', masterId)
    .order('codice_cliente', { ascending: false }).limit(1)
  let prossimo = 1
  const n = parseInt(String(ultimi?.[0]?.codice_cliente || '').replace(/\D/g, ''), 10)
  if (!isNaN(n)) prossimo = n + 1
  const codice = `CLI-${String(prossimo).padStart(4, '0')}`

  const { data: nuovo, error } = await admin.from('clienti').insert({
    master_id: masterId,
    ragione_sociale: nome,
    email: null,                                    // si autentica via Shopify: nessun login MoovExpress
    telefono: addr.phone || null,
    sl_paese: addr.country || 'Italia', sl_indirizzo: addr.address1 || null,
    sl_citta: addr.city || null, sl_provincia: addr.provinceCode || addr.province || null, sl_cap: addr.zip || null,
    listino_cliente_id: await onboardingListinoId(admin, masterId),
    tipo_contratto: 'credito_scalare',
    aliquota_iva: '22',
    codice_cliente: codice,
    attivo: true,
  }).select('id').single()
  if (error || !nuovo) return { error: error?.message || 'Errore creazione cliente' }

  return { clienteId: nuovo.id, masterId }
}
