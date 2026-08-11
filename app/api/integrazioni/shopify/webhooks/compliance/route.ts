import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Endpoint UNICO per i webhook di conformita' GDPR di Shopify.
// Shopify invia tutti e tre i topic (customers/data_request, customers/redact,
// shop/redact) a questo stesso URL: distinguiamo dall'header X-Shopify-Topic.
//
// IMPORTANTE — perche' il client ADMIN e non createServerSupabase():
// un webhook Shopify arriva SENZA cookie di sessione. createServerSupabase() usa la
// ANON key, e con la RLS attiva su integrazioni/ordini_ecommerce le query di un
// utente anonimo vedono ZERO righe: la delete colpiva 0 record e si rispondeva 200
// pur non cancellando NULLA (buco GDPR silenzioso). Il service role bypassa la RLS,
// come gia' fa il callback OAuth per lo stato cross-site senza cookie.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyWebhook(raw, hmac)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const topic = req.headers.get('x-shopify-topic') || ''
  let body: any = {}
  try { body = JSON.parse(raw) } catch {}

  try {
    const admin = createAdminSupabase()

    // shop/redact (48h dopo la disinstallazione): rimozione COMPLETA dei dati del negozio.
    if (topic === 'shop/redact') {
      const shop = body.shop_domain || req.headers.get('x-shopify-shop-domain') || ''
      if (shop) {
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
      }
    }

    // customers/redact: cancellazione dei dati di UNO specifico cliente. Il payload elenca
    // orders_to_redact (id ordine legacy numerici): eliminiamo quelle righe da ordini_ecommerce
    // (dove vive la copia sincronizzata dei dati destinatario), circoscritte al negozio mittente.
    // Le spedizioni gia' generate restano come documento fiscale/logistico (base giuridica di
    // conservazione autonoma), ma la copia dell'ordine Shopify con i PII viene rimossa.
    if (topic === 'customers/redact') {
      const shop = body.shop_domain || req.headers.get('x-shopify-shop-domain') || ''
      const ordersToRedact: string[] = Array.isArray(body.orders_to_redact)
        ? body.orders_to_redact.map((x: any) => String(x)) : []
      if (shop && ordersToRedact.length) {
        const { data: ints } = await admin
          .from('integrazioni').select('id')
          .eq('piattaforma', 'shopify').eq('identificativo', shop)
        const ids = (ints || []).map((i: any) => i.id)
        if (ids.length) {
          await admin.from('ordini_ecommerce').delete()
            .in('integrazione_id', ids).in('ordine_esterno_id', ordersToRedact)
        }
      }
    }

    // customers/data_request: non conserviamo un profilo cliente separato dagli ordini
    // (i dati sono nell'ordine, gia' visibile al merchant nel suo admin Shopify): ack 200.
  } catch (e) {
    // Non blocchiamo l'ack: Shopify richiede comunque 200 e ritenta in caso di errore.
    console.error('shopify compliance webhook error', topic, e)
  }

  return new NextResponse('OK', { status: 200 })
}
