import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '@/lib/shopifyWebhook'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { cancellaSospesiDelNegozio } from '@/lib/shopifyCollega'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Quando il merchant disinstalla l'app, il token non e' piu' valido.
// Marchiamo l'integrazione come disconnessa e svuotiamo le credenziali. La riga resta col suo cliente: alla
// reinstallazione il negozio torna li' (lib/shopifyProvision.ts, trovaContoDelNegozio).
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
    // Admin client (service_role): il webhook arriva SENZA cookie di sessione. Con createServerSupabase
    // (ANON) la RLS su integrazioni nascondeva ogni riga -> l'update colpiva 0 record e la
    // disinstallazione NON veniva registrata (silenziosamente). Come le altre route webhook.
    const supabase = createAdminSupabase()

    // SOLO QUELLO CHE E' NATO PRIMA DELLA DISINSTALLAZIONE. Shopify non garantisce l'ordine dei webhook e ripete
    // quelli a cui si risponde con un errore (qui sotto: 500 su un guasto, fino a 8 volte in 4 ore). Un
    // app/uninstalled scattato prima di una reinstallazione poteva quindi arrivare DOPO: spegneva il collegamento
    // appena rifatto (sincronizzazioni ed evasioni su «Credenziali Shopify mancanti») e toglieva l'installazione
    // in sospeso a chi stava scegliendo l'account. Installa, disinstalla, reinstalla e' la prova di chi fa la
    // revisione. L'istante dell'evento e' X-Shopify-Triggered-At, quello che la guida Shopify indica per mettere
    // in ordine i webhook; l'autorizzazione porta il suo (credenziali.autorizzato_il, scritto dal callback).
    // Senza l'intestazione, o se non si legge, si fa come prima: si spegne tutto.
    const scattato = new Date(req.headers.get('x-shopify-triggered-at') || '')
    const istante = Number.isFinite(scattato.getTime()) ? scattato.toISOString() : null
    if (!istante) console.warn('[SHOPIFY][APP-UNINSTALLED] X-Shopify-Triggered-At assente o illeggibile: disinstallazione senza controllo dell\'ordine', shop)

    // L'ESITO SI LEGGE. supabase-js non lancia eccezioni: restituisce { error }. Fino al 21/10/2026 qui c'era
    // solo un catch, che un errore del database non lo vedeva mai: la disinstallazione si perdeva, la riga
    // restava 'attivo' con un token morto e Shopify riceveva 200. Ora un guasto risponde 500 e Shopify ripete
    // il webhook, come per quelli di conformita' (webhooks/compliance).
    const guasti: string[] = []
    let spente = 0
    // Una riga gia' 'disconnesso' ha gia' le credenziali vuote: non si riscrive, e non conta fra le spente.
    const spegni = async (cosa: string, filtra: (q: any) => any) => {
      const q = supabase
        .from('integrazioni')
        .update({ stato: 'disconnesso', credenziali: {}, errore: 'App disinstallata su Shopify' })
        .eq('piattaforma', 'shopify')
        .eq('identificativo', shop)
        .neq('stato', 'disconnesso')
      const { data, error } = await filtra(q).select('id')
      if (error) guasti.push(`${cosa}: ${error.message}`)
      else spente += (data || []).length
    }
    try {
      if (istante) {
        // Il confronto e' fra testi ISO dello stesso formato (toISOString da tutte e due le parti), quindi
        // segue l'ordine del tempo. Le righe collegate prima del 21/10/2026 non hanno autorizzato_il: per loro
        // vale la regola di prima.
        await spegni('integrazione', (q) => q.lt('credenziali->>autorizzato_il', istante))
        await spegni('integrazione senza data d\'autorizzazione', (q) => q.is('credenziali->>autorizzato_il', null))
      } else {
        await spegni('integrazione', (q) => q)
      }
      // Un'installazione che aspettava la scelta dell'account (lib/shopifyCollega.ts) tiene un token che la
      // disinstallazione ha appena reso inutile: non deve restare, ne' potersi collegare dopo. Quella nata dopo
      // la disinstallazione e' di una reinstallazione, e resta.
      const { error: eSospeso } = await cancellaSospesiDelNegozio(supabase, shop, istante || undefined)
      if (eSospeso) guasti.push(`installazione in sospeso: ${eSospeso.message}`)
    } catch (e: any) {
      guasti.push(String(e?.message || e))
    }
    if (guasti.length) {
      console.error('[SHOPIFY][APP-UNINSTALLED] disinstallazione non registrata', shop, guasti.join(' | '))
      return new NextResponse('Retry', { status: 500 })
    }
    // Una riga per disinstallazione (sono rare): istante dell'evento e consegna dicono, nei log, se un webhook
    // ripetuto porta lo stesso X-Shopify-Triggered-At, cosa che la guida non scrive. 0 collegamenti spenti vuol
    // dire: nessuna riga, una riga gia' spenta, o un'autorizzazione piu' nuova del webhook, lasciata com'e'.
    console.warn('[SHOPIFY][APP-UNINSTALLED] disinstallazione registrata', shop, 'evento', istante || '?',
      'consegna', req.headers.get('x-shopify-webhook-id') || '?', 'collegamenti spenti', spente)
  }

  return new NextResponse('OK', { status: 200 })
}
