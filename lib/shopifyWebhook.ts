import crypto from 'crypto'

/**
 * Verifica la firma HMAC di un webhook Shopify.
 * Shopify firma il CORPO GREZZO (raw body) con SHOPIFY_API_SECRET e invia
 * il digest base64 nell'header X-Shopify-Hmac-Sha256.
 */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_API_SECRET
  if (!secret || !hmacHeader) return false
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader))
  } catch {
    return false
  }
}
