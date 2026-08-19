import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// L'app Shopify e' NON-embedded: l'ingresso ufficiale (App URL) e' /api/integrazioni/shopify/enter.
// Qui c'era la vecchia UI EMBEDDED (App Bridge), rimossa perche' in contraddizione col flusso attuale
// e mai raggiunta da Shopify. Restiamo con un redirect gentile: se un vecchio segnalibro o una vecchia
// App URL punta ancora a /shopify, invece di una pagina rotta si finisce all'ingresso giusto (o nel
// portale). Se arrivano shop+hmac di Shopify, li inoltriamo TUTTI a /enter, che fa la verifica.
export default async function ShopifyRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const shop = String(sp.shop || '').toLowerCase()
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') qs.set(k, v)
    redirect(`/api/integrazioni/shopify/enter?${qs.toString()}`)
  }
  redirect('/cliente')
}
