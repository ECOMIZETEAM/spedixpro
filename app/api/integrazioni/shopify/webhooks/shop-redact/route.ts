import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GDPR: 48h dopo la disinstallazione Shopify chiede di cancellare i dati del negozio.
// I topic di conformita' sono registrati (toml) verso /webhooks/compliance: questo endpoint
// standalone e' ridondante, ma lo teniamo COMPLETO e CORRETTO (admin/service role, non
// createServerSupabase che senza cookie di sessione + RLS cancellerebbe 0 righe) cosi' non
// e' una trappola se una vecchia sottoscrizione lo chiamasse ancora.
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
      const admin = createAdminSupabase()
      const { data: ints } = await admin
        .from('integrazioni').select('id')
        .eq('piattaforma', 'shopify').eq('identificativo', shop)
      const ids = (ints || []).map((i: any) => i.id)
      if (ids.length) {
        // ordini_ecommerce = tabella attuale (con i dati destinatario); ordini_importati = legacy
        await admin.from('ordini_ecommerce').delete().in('integrazione_id', ids)
        await admin.from('ordini_importati').delete().in('integrazione_id', ids)
        await admin.from('integrazioni').delete().in('id', ids)
      }
    } catch (e) {
      // Non blocchiamo l'ack: Shopify richiede comunque 200.
      console.error('shop/redact cleanup error', e)
    }
  }

  return new NextResponse('OK', { status: 200 })
}
