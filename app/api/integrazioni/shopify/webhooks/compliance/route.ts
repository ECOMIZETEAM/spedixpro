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

  // ESITO DELLE CANCELLAZIONI: si guarda.
  //
  // Prima le delete partivano e nessuno controllava se avessero funzionato: se una falliva si
  // rispondeva comunque 200 e i dati restavano li', con Shopify convinto che fossero stati
  // cancellati. Un buco GDPR che non lasciava traccia. Ora un fallimento si annota e si risponde
  // 500: Shopify RITENTA i webhook di conformita', quindi un errore vero e' meglio di un falso ok.
  const guasti: string[] = []
  const cancella = async (q: any, cosa: string) => {
    const { error } = await q
    if (error) { guasti.push(`${cosa}: ${error.message}`); console.error('[SHOPIFY][GDPR] cancellazione fallita', cosa, error.message) }
  }

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
          await cancella(admin.from('ordini_ecommerce').delete().in('integrazione_id', ids), 'ordini_ecommerce')
          await cancella(admin.from('ordini_importati').delete().in('integrazione_id', ids), 'ordini_importati')
          await cancella(admin.from('integrazioni').delete().in('id', ids), 'integrazioni')
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
          await cancella(admin.from('ordini_ecommerce').delete()
            .in('integrazione_id', ids).in('ordine_esterno_id', ordersToRedact), 'ordini_ecommerce (cliente)')
        }
      }
    }

    // customers/data_request: il merchant chiede i dati che teniamo su un suo cliente.
    //
    // L'obbligo non e' rispondere, e' CONSEGNARE. Prima si rispondeva 200 e basta, quindi nessuno
    // sapeva nemmeno che la richiesta fosse arrivata: se un merchant l'avesse fatta davvero, si
    // sarebbe persa. Ora resta scritta con chi l'ha chiesta e per quali ordini, e si evade a mano
    // entro i termini (shopify_richieste_dati, `evasa_il` NULL = ancora da evadere).
    if (topic === 'customers/data_request') {
      const shop = body.shop_domain || req.headers.get('x-shopify-shop-domain') || ''
      const { error } = await admin.from('shopify_richieste_dati').insert({
        shop: String(shop || 'sconosciuto'),
        cliente_shopify_id: body?.customer?.id ? String(body.customer.id) : null,
        email: body?.customer?.email || null,
        ordini: Array.isArray(body?.orders_requested) ? body.orders_requested.map((x: any) => String(x)) : [],
        payload: body || {},
      })
      if (error) { guasti.push('richiesta dati: ' + error.message); console.error('[SHOPIFY][GDPR] richiesta dati non registrata', error.message) }
    }
  } catch (e: any) {
    guasti.push(String(e?.message || e))
    console.error('shopify compliance webhook error', topic, e)
  }

  // Un guasto NON si nasconde dietro un 200: Shopify ritenta, ed e' esattamente cio' che serve.
  if (guasti.length) return new NextResponse('Retry: ' + guasti.join(' | ').slice(0, 200), { status: 500 })
  return new NextResponse('OK', { status: 200 })
}
