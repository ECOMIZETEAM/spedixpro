import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { loginMerchantERedirect } from '@/lib/shopifyLogin'
import crypto from 'crypto'
import { accessoDelCliente } from '@/lib/accesso-cliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

// Verifica la firma HMAC dei parametri della App URL (come per l'OAuth)
function verifyHmac(sp: URLSearchParams, secret: string): boolean {
  const hmac = sp.get('hmac') || ''
  const entries: string[] = []
  sp.forEach((v, k) => { if (k !== 'hmac' && k !== 'signature') entries.push(`${k}=${v}`) })
  entries.sort()
  const digest = crypto.createHmac('sha256', secret).update(entries.join('&')).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex')) } catch { return false }
}

// App URL (modello NON embedded / redirect): quando il merchant apre l'app da Shopify,
// verifichiamo la firma, troviamo il suo account MoovExpress e lo portiamo nel portale
// già loggato. Se il negozio non è ancora collegato, avviamo l'installazione (OAuth).
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = url.searchParams
  const shop = (sp.get('shop') || '').toLowerCase()
  const secret = process.env.SHOPIFY_API_SECRET
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!secret || !SHOP_RE.test(shop)) {
    return NextResponse.redirect(new URL('/cliente', req.url))
  }
  // la richiesta deve arrivare da Shopify (firma valida)
  if (!verifyHmac(sp, secret)) {
    return NextResponse.redirect(new URL('/cliente?error=firma', req.url))
  }

  const admin = createAdminSupabase()
  // NIENTE EMBED `clienti(email)`: PostgREST risolve gli embed SOLO attraverso una foreign key, e
  // `integrazioni` non ne ha nessuna (verificato su pg_constraint: c'e' solo la chiave primaria).
  // Quella select falliva SEMPRE, quindi `integr` era sempre nullo e l'auto-login del merchant non
  // ha mai funzionato: chi apriva l'app da Shopify finiva comunque sull'installazione. L'email si
  // legge a parte, qui sotto: costa qualche query in piu' e funziona.
  const { data: integr } = await admin.from('integrazioni')
    .select('cliente_id,stato,credenziali')
    .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  // SI ENTRA COME L'UTENTE DI LOGIN DEL CLIENTE, la stessa regola del callback (lib/accesso-cliente.ts),
  // non con clienti.email (NMC-14). Fino al 20/10/2026 qui il magic link si chiedeva per clienti.email: se
  // e' l'email di login di un altro utente si entrava come lui; se non ha un utente, generateLink lo crea,
  // orfano e senza riga in `utenti` (portale senza menu), e da li' l'installazione non riesce piu' a dare
  // l'accesso al conto, perche' l'email risulta gia' presa. Senza accesso il negozio conta come non
  // collegato e si riparte dall'OAuth: e' li' che nasce l'accesso del conto creato dall'installazione
  // (lib/shopifyProvision.ts, assicuraAccesso).
  const email = integr?.cliente_id ? (await accessoDelCliente(admin, integr.cliente_id))?.email || null : null

  // NEGOZIO NON COLLEGATO → si riparte dall'OAuth.
  //
  // "Non collegato" NON e' solo "riga assente". Alla disinstallazione il webhook app/uninstalled
  // NON cancella la riga: la marca `stato='disconnesso'` e SVUOTA le credenziali, per non perdere
  // lo storico del cliente. Guardando solo cliente_id, alla REINSTALLAZIONE trovavamo la riga
  // vecchia, saltavamo l'OAuth e facevamo entrare il merchant nel portale — con un'integrazione
  // senza token. Da li' in poi ogni sync e ogni evasione morivano su "Credenziali Shopify
  // mancanti", e l'unico modo di rientrare era ridigitare il dominio a mano dalle Integrazioni.
  //
  // Due requisiti di review in un colpo solo: 2.3.4 ("must immediately authenticate using OAuth
  // before any other steps occur, EVEN IF the merchant has previously installed and then
  // uninstalled your app") e, di rimbalzo, 2.1.4 — l'app reinstallata non mostrava piu' un ordine.
  // Installa → disinstalla → reinstalla e' un passaggio standard di chi fa la revisione.
  //
  // Il callback e' gia' idempotente sul riaggancio (aggiorna la riga esistente per identificativo),
  // quindi ripassare dall'OAuth non crea doppioni. E con la managed installation il consenso e'
  // gia' dato: l'authorize torna subito il codice, il merchant non vede nessuna schermata in piu'.
  const token = ((integr as any)?.credenziali || {}).access_token
  const vivo = !!integr?.cliente_id && !!email && (integr as any)?.stato === 'attivo' && !!token
  if (!vivo) {
    return NextResponse.redirect(`${appUrl}/api/integrazioni/shopify/install?shop=${encodeURIComponent(shop)}`)
  }

  // login automatico nel portale
  return loginMerchantERedirect(req, email, '/cliente/dashboard')
}
