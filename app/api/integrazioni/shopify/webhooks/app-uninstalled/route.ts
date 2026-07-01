import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Quando il merchant disinstalla l'app, il token non e' piu' valido.
// Marchiamo l'integrazione come disconnessa e svuotiamo le credenziali.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let shop = req.headers.get('x-shopify-shop-domain') || ''
  try {
    const p = JSON.parse(raw)
    shop = p.myshopify_domain || p.domain || shop
  } catch {}

  if (shop) {
    try {
      const supabase = await createServerSupabase()
      await supabase
        .from('integrazioni')
        .update({ stato: 'disconnesso', credenziali: {}, errore: 'App disinstallata su Shopify' })
        .eq('piattaforma', 'shopify')
        .eq('identificativo', shop)
    } catch (e) {
      console.error('app/uninstalled update error', e)
    }
  }

  return new NextResponse('OK', { status: 200 })
}
