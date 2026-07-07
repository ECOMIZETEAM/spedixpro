import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Endpoint UNICO per i webhook di conformita' GDPR di Shopify.
// Shopify invia tutti e tre i topic (customers/data_request, customers/redact,
// shop/redact) a questo stesso URL: distinguiamo dall'header X-Shopify-Topic.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const topic = req.headers.get('x-shopify-topic') || ''

  // Solo shop/redact richiede una cancellazione dati lato nostro.
  if (topic === 'shop/redact') {
    let shop = req.headers.get('x-shopify-shop-domain') || ''
    try {
      const p = JSON.parse(raw)
      shop = p.shop_domain || shop
    } catch {}
    if (shop) {
      try {
        const supabase = await createServerSupabase()
        const { data: ints } = await supabase
          .from('integrazioni')
          .select('id')
          .eq('piattaforma', 'shopify')
          .eq('identificativo', shop)
        const ids = (ints || []).map((i: any) => i.id)
        if (ids.length) {
          // ordini_ecommerce = tabella attuale (con i dati cliente); ordini_importati = legacy
          await supabase.from('ordini_ecommerce').delete().in('integrazione_id', ids)
          await supabase.from('ordini_importati').delete().in('integrazione_id', ids)
          await supabase.from('integrazioni').delete().in('id', ids)
        }
      } catch (e) {
        console.error('shop/redact cleanup error', e)
      }
    }
  }

  // customers/data_request e customers/redact: non conserviamo un profilo
  // cliente separato dagli ordini, quindi rispondiamo con ack 200.
  return new NextResponse('OK', { status: 200 })
}
