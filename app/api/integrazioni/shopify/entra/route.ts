import { NextRequest } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { collegamentoShopifyVivo, eNegozioShopify } from '@/lib/shopifyOAuth'
import { conCookie, confermaIngressoValida, entraNelPortaleDaShopify, utenteDelBrowser } from '@/lib/accesso-cliente'
import { paginaIngressoNonConfermato } from '@/lib/shopify-pagina-scelta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// «SEI DENTRO COME … VUOI USCIRE ED ENTRARE NEL CONTO DEL NEGOZIO?»: IL PULSANTE.
//
// Decisione di Lorenzo del 21/10/2026: l'accesso automatico da Shopify non sostituisce in silenzio la sessione
// di un'altra persona (lib/accesso-cliente.ts, entraNelPortaleDaShopify). La pagina di conferma
// (lib/shopify-pagina-scelta.ts) manda qui il negozio e un gettone firmato; questa rotta ricontrolla tutto
// quello che puo' essere cambiato nei cinque minuti del gettone, poi fa l'accesso automatico con un 303 (dopo
// un 307 il browser ripeterebbe il POST sulla dashboard). Sul modello di app/api/integrazioni/amazon/accesso.
//
// Ogni rifiuto e' una pagina, non un rimando al portale: chi e' dentro con lo staff verrebbe portato alla sua
// dashboard senza il motivo. La strada e' sempre riaprire l'app da Shopify, che rifa' i controlli da capo.
// Nessun GET: un indirizzo che fa entrare in un conto non deve poterlo aprire un link.
export async function POST(req: NextRequest) {
  // Il modulo deve venire dalla pagina di conferma. Un browser che lo dice (Sec-Fetch-Site) deve dire «stesso
  // sito»; uno che non lo dice e' fermato dalla sessione (qui sotto): i suoi cookie (SameSite=Lax) non partono
  // con un modulo inviato da un altro sito, e senza la sessione di chi ha visto la pagina il gettone non vale.
  const sito = req.headers.get('sec-fetch-site')
  if (sito && sito !== 'same-origin') {
    console.warn('[SHOPIFY][ENTRA] conferma partita da un altro sito: rifiutata', sito)
    return paginaIngressoNonConfermato('non_valida')
  }

  const form = await req.formData().catch(() => null)
  const shop = String(form?.get('shop') || '').trim().toLowerCase()
  const gettone = String(form?.get('gettone') || '')
  if (!eNegozioShopify(shop) || !gettone) return paginaIngressoNonConfermato('non_valida')

  // La conferma vale per la sessione che l'ha vista, e solo con quella (lib/accesso-cliente.ts, il gettone).
  // Senza sessione non e' una conferma: chi non e' dentro entra da solo riaprendo l'app.
  const dentro = await utenteDelBrowser(req)
  if (dentro.stato === 'illeggibile') return paginaIngressoNonConfermato('temporaneo')
  if (dentro.stato !== 'utente') {
    console.warn('[SHOPIFY][ENTRA] conferma senza sessione nel browser: rifiutata', shop)
    return paginaIngressoNonConfermato('non_valida')
  }
  // Se si resta fuori, la sessione di prima resta: con i cookie rinnovati dalla verifica, se li ha rinnovati.
  const resta = (motivo: 'non_valida' | 'temporaneo') => conCookie(paginaIngressoNonConfermato(motivo), dentro.cookie)

  // IL NEGOZIO E' ANCORA COLLEGATO, E ALLO STESSO CONTO. Il conto di destinazione non arriva dal modulo: si
  // rilegge dalla riga del negozio e il gettone deve essere stato firmato per quello. Un negozio disinstallato,
  // col token morto o passato a un altro conto dopo la pagina non fa entrare nessuno. Che il conto sia ancora
  // quello nato da QUESTO negozio, e che abbia il suo accesso, lo ricontrolla entraNelPortaleDaShopify.
  const admin = createAdminSupabase()
  const { data: riga, error } = await admin.from('integrazioni')
    .select('cliente_id,stato,credenziali')
    .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  if (error) {
    console.error('[SHOPIFY][ENTRA] lettura dell\'integrazione', shop, error.message)
    return resta('temporaneo')
  }
  if (!riga || !collegamentoShopifyVivo(riga)) {
    console.warn('[SHOPIFY][ENTRA] il negozio non e\' piu\' collegato: conferma rifiutata', shop)
    return resta('non_valida')
  }
  const clienteId = String(riga.cliente_id)
  if (!confermaIngressoValida(gettone, { shop, clienteId, utenteId: dentro.utenteId })) {
    // Scaduto, firmato per un altro conto o per un'altra sessione: nel log solo negozio e utente, mai il gettone.
    console.warn('[SHOPIFY][ENTRA] gettone non valido o scaduto', shop, dentro.utenteId)
    return resta('non_valida')
  }

  return entraNelPortaleDaShopify(req, admin, { clienteId, shop, status: 303, confermatoDa: dentro })
}
