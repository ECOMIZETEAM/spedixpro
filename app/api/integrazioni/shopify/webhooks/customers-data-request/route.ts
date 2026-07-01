import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GDPR: richiesta dei dati di un cliente.
// SpedixPro non conserva PII del cliente separatamente dagli ordini importati,
// quindi non c'e' un profilo cliente da esportare: rispondiamo con ack 200.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return new NextResponse('OK', { status: 200 })
}
