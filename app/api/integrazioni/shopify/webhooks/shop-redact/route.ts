import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GDPR: 48h dopo la disinstallazione Shopify chiede di cancellare i dati del negozio.
// Eliminiamo l'integrazione e gli ordini importati collegati a quel negozio.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

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
        await supabase.from('ordini_importati').delete().in('integrazione_id', ids)
        await supabase.from('integrazioni').delete().in('id', ids)
      }
    } catch (e) {
      // Non blocchiamo l'ack: Shopify richiede comunque 200.
      console.error('shop/redact cleanup error', e)
    }
  }

  return new NextResponse('OK', { status: 200 })
}
