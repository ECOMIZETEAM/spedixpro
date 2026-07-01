import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GDPR: richiesta di cancellazione dati di uno specifico cliente.
// I dati destinatario vivono negli ordini importati e non sono profilati per
// cliente Shopify in modo affidabile; l'eliminazione massiva avviene su
// shop/redact e app/uninstalled. Qui rispondiamo con ack 200.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return new NextResponse('OK', { status: 200 })
}
