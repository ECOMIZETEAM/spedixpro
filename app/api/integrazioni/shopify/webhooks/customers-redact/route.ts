import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GDPR: richiesta di cancellazione dati di UNO specifico cliente.
// I topic di conformita' sono registrati (toml) verso /webhooks/compliance: questo endpoint
// standalone e' ridondante ma lo teniamo corretto. Il payload elenca orders_to_redact (id
// ordine legacy numerici): eliminiamo quelle righe da ordini_ecommerce (copia sincronizzata
// dei dati destinatario), circoscritte al negozio mittente. Le spedizioni gia' generate
// restano come documento fiscale/logistico (base di conservazione autonoma).
// Admin/service role: un webhook non ha cookie di sessione, con la anon key + RLS cancellerebbe 0 righe.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    let body: any = {}
    try { body = JSON.parse(raw) } catch {}
    const shop = body.shop_domain || req.headers.get('x-shopify-shop-domain') || ''
    const ordersToRedact: string[] = Array.isArray(body.orders_to_redact)
      ? body.orders_to_redact.map((x: any) => String(x)) : []
    if (shop && ordersToRedact.length) {
      const admin = createAdminSupabase()
      const { data: ints } = await admin
        .from('integrazioni').select('id')
        .eq('piattaforma', 'shopify').eq('identificativo', shop)
      const ids = (ints || []).map((i: any) => i.id)
      if (ids.length) {
        await admin.from('ordini_ecommerce').delete()
          .in('integrazione_id', ids).in('ordine_esterno_id', ordersToRedact)
      }
    }
  } catch (e) {
    console.error('customers/redact cleanup error', e)
  }

  return new NextResponse('OK', { status: 200 })
}
