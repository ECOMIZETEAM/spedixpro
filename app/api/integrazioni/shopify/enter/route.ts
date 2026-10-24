import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { verificaLinkShopify } from '@/lib/shopifyFirma'
import { conErrore } from '@/lib/esiti-collegamento'
import { entraNelPortaleDaShopify } from '@/lib/accesso-cliente'
import { avviaOAuthShopify, collegamentoShopifyVivo, eNegozioShopify } from '@/lib/shopifyOAuth'
import { getValidShopifyToken, shopifyGraphQL } from '@/lib/shopify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Quanto aspetta il negoziante la prova del token prima di entrare lo stesso. La prova normale sono una o due
// chiamate a Shopify (il rinnovo, se il token sta per scadere, e la domanda): meno di un secondo. Di piu' e'
// Shopify lento o che chiede di rallentare (shopifyGraphQL aspetta e riprova da solo), e non dice niente del token.
const PROVA_TOKEN_MS = 4000

// Shopify accetta ancora il token di questo negozio? true solo se ha risposto alla domanda piu' piccola che
// c'e' (l'id del negozio). Non lancia mai: un fallimento torna false, e il perche' lo dice la riga del negozio
// (vedi sotto).
async function provaIlToken(integr: any, shop: string): Promise<boolean> {
  try {
    const t = await getValidShopifyToken(integr)
    if (!t.token) return false
    await shopifyGraphQL(shop, t.token, '{ shop { id } }')
    return true
  } catch {
    return false
  }
}

async function entroIlTempo<T>(p: Promise<T>, ms: number): Promise<T | 'tempo'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tempo = new Promise<'tempo'>((fatto) => { timer = setTimeout(() => fatto('tempo'), ms) })
  try {
    return await Promise.race([p, tempo])
  } finally {
    clearTimeout(timer)
  }
}

// App URL (modello NON embedded / redirect): quando il merchant apre l'app da Shopify verifichiamo la
// firma e, se il negozio e' collegato col token ancora vivo, lo portiamo nel portale (da solo, senza
// password, solo nel conto nato dall'installazione di QUEL negozio: lib/accesso-cliente.ts). Altrimenti parte
// l'autorizzazione (OAuth), da qui e solo da qui (lib/shopifyOAuth.ts).
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const shop = (sp.get('shop') || '').toLowerCase()
  const secret = process.env.SHOPIFY_API_SECRET

  if (!secret || !eNegozioShopify(shop)) {
    return NextResponse.redirect(new URL('/cliente', req.url))
  }
  // La richiesta deve arrivare da Shopify (firma valida) ed essere appena partita (lib/shopifyFirma.ts).
  // Il controllo sta prima del database: un link scaduto non legge niente e non avvia l'autorizzazione, che
  // scrive uno state a ogni avvio.
  const link = verificaLinkShopify(sp, secret)
  if (link.esito === 'firma_falsa') {
    return NextResponse.redirect(new URL(conErrore('/cliente', 'firma'), req.url))
  }
  // UN LINK VECCHIO NON ENTRA. Fino al 20/10/2026 lo stesso indirizzo riapriva il portale per sempre, a
  // chiunque lo ritrovasse in una cronologia o in un log. Ora si ferma sulla pagina che dice di riaprire
  // MoovExpress dall'admin del negozio: li' Shopify firma un link nuovo solo per chi e' loggato su Shopify,
  // quindi il negoziante vero rientra e chi ha un link ripescato no.
  // Niente rimando automatico all'admin (https://{shop}/admin/apps/{client_id}): per un'app non embedded
  // nessuna guida dice che riapra l'app con un link nuovo, e finche' non e' provato sul dev store un
  // rimbalzo potrebbe finire in una pagina senza uscita invece che su questa, che dice cosa fare.
  if (link.esito === 'scaduto') {
    // Nel log solo negozio e scarto: mai l'hmac ne' l'indirizzo, che fino alla scadenza valgono un accesso.
    // La firma qui e' buona, quindi il link l'ha fatto Shopify: un link vecchio ha lo scarto positivo.
    // Senza un timestamp valido (scarto null) o con uno nel futuro non e' un link ritrovato in una
    // cronologia: e' il formato del tempo (in millisecondi lo scarto e' dell'ordine di -1e12) o un orologio
    // sfasato, e allora non entra NESSUN negoziante. Va fra gli errori, per non confonderlo coi link vecchi.
    if (link.scartoSec === null || link.scartoSec < 0) {
      console.error('[SHOPIFY][ENTER] link scaduto ANOMALO, timestamp assente o nel futuro', shop, 'scarto s:', link.scartoSec)
    } else {
      console.warn('[SHOPIFY][ENTER] link scaduto', shop, 'scarto s:', link.scartoSec)
    }
    return NextResponse.redirect(new URL(conErrore('/cliente', 'link_scaduto'), req.url))
  }

  const admin = createAdminSupabase()
  // NIENTE EMBED `clienti(email)`: PostgREST risolve gli embed SOLO attraverso una foreign key, e
  // `integrazioni` non ne ha nessuna (verificato su pg_constraint: c'e' solo la chiave primaria).
  // Quella select falliva SEMPRE, quindi `integr` era sempre nullo e l'auto-login del merchant non
  // ha mai funzionato: chi apriva l'app da Shopify finiva comunque sull'installazione. Il cliente si
  // legge a parte (lib/accesso-cliente.ts): costa qualche query in piu' e funziona.
  // id e identificativo servono alla prova del token: un rinnovo salva il token nuovo sulla riga per id, e il
  // negozio a cui chiedere lo prende dalle credenziali o, se li' manca, dall'identificativo (lib/shopify.ts).
  const { data: integr, error: eIntegr } = await admin.from('integrazioni')
    .select('id,identificativo,cliente_id,stato,credenziali')
    .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  // UNA LETTURA FALLITA NON E' «NEGOZIO NON COLLEGATO». Fino al 21/10/2026 l'errore non si leggeva e si
  // ripartiva dall'OAuth: lo scambio del codice ritira subito ogni altro refresh token dell'app sul negozio
  // (guida Shopify, access tokens), quindi un negozio collegato e vivo poteva perdere il suo token per un
  // guasto passeggero, se poi il callback non riusciva a salvare quello nuovo. Vale anche per due righe
  // dello stesso negozio, dove maybeSingle da' errore: meglio fermo e scritto nei log che ricollegato a caso.
  if (eIntegr) {
    console.error('[SHOPIFY][ENTER] lettura dell\'integrazione', shop, eIntegr.message)
    return NextResponse.redirect(new URL(conErrore('/cliente', 'ingresso_non_riuscito'), req.url))
  }

  // L'autorizzazione non porta con se' la sessione del browser: fino al 21/10/2026 il cliente gia' entrato
  // finiva nello state (lo faceva /install), ma il callback non lo legge piu'. A chi va il negozio lo decide la
  // sua riga, o per un negozio mai visto la scelta del negoziante (app/api/integrazioni/shopify/callback).
  const autorizza = () => avviaOAuthShopify(req, shop)

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
  // ...E NEMMENO UN NEGOZIO COL TOKEN MORTO. Fino al 21/10/2026 bastava un token presente: con uno che
  // Shopify non rinnovava piu' si entrava in un portale dove gli ordini non arrivavano, e tolto il campo del
  // dominio dalle Integrazioni l'unica uscita sarebbe stata disinstallare l'app. Ora un rinnovo rifiutato o
  // un 401 mettono la riga in 'errore' (lib/shopify.ts), e qui non conta come viva nemmeno una riga senza
  // refresh token (il tipo vecchio, non scadente, che Shopify rifiuta) o con il refresh token oltre la sua
  // scadenza (90 giorni dal rilascio): nessuno dei due rinnova piu' niente.
  //
  // Il callback e' gia' idempotente sul riaggancio (aggiorna la riga esistente per identificativo),
  // quindi ripassare dall'OAuth non crea doppioni. E con la managed installation il consenso e'
  // gia' dato: l'authorize torna subito il codice, il merchant non vede nessuna schermata in piu'.
  // La regola sulla riga sta in lib/shopifyOAuth.ts (collegamentoShopifyVivo): la usa anche la conferma
  // dell'ingresso (app/api/integrazioni/shopify/entra).
  if (!collegamentoShopifyVivo(integr)) return autorizza()

  // ...E LA RIGA NON BASTA: SI CHIEDE A SHOPIFY. Una riga 'attivo' dice com'era il token l'ultima volta che
  // l'abbiamo usato. Chi disinstalla e reinstalla in fretta (il revisore di Shopify lo fa di mestiere) riapre
  // l'app prima che arrivi il webhook app/uninstalled: fino al 21/10/2026 si entrava senza autorizzazione con
  // un token gia' revocato, poi il webhook spegneva la riga, e il negozio risultava scollegato con l'app
  // installata (requisito 2.3.4). Ora una domanda minima a Shopify prova il token. Un 401, o un rinnovo
  // rifiutato, mettono la riga in 'errore' (lib/shopify.ts, segnaCollegamentoMorto): rilette dopo una prova
  // fallita, la riga che non e' piu' 'attivo' fa ripartire l'autorizzazione, che salva un token nuovo con la
  // sua data, e il webhook in ritardo non lo tocca (webhooks/app-uninstalled). Ogni altro fallimento (Shopify
  // che risponde 5xx, la rete, la prova che non finisce in tempo) non dice che il token e' morto: si entra come
  // prima, e una nuova autorizzazione ritirerebbe per niente un refresh token buono (guida Shopify, access tokens).
  const prova = provaIlToken(integr, shop)
  const esitoProva = await entroIlTempo(prova, PROVA_TOKEN_MS)
  if (esitoProva === 'tempo') {
    // La prova continua dopo la risposta: se sta rinnovando il token, il refresh token nuovo deve arrivare
    // sulla riga, perche' Shopify ha gia' ritirato quello vecchio.
    after(prova)
    console.warn('[SHOPIFY][ENTER] prova del token oltre il tempo: si entra senza aspettarla', shop)
  } else if (!esitoProva) {
    const { data: dopo, error: eDopo } = await admin.from('integrazioni').select('stato').eq('id', (integr as any).id).maybeSingle()
    if (eDopo) {
      console.error('[SHOPIFY][ENTER] prova del token fallita e riga illeggibile: si entra come prima', shop, eDopo.message)
    } else if (dopo?.stato !== 'attivo') {
      console.warn('[SHOPIFY][ENTER] Shopify non accetta piu\' il token: si rifa\' l\'autorizzazione', shop, dopo?.stato || 'riga sparita')
      return autorizza()
    } else {
      console.warn('[SHOPIFY][ENTER] prova del token non riuscita per un guasto passeggero: si entra come prima', shop)
    }
  }

  // NEGOZIO VIVO: SI ENTRA. Da soli, con l'accesso automatico, solo nel conto nato dall'installazione di QUESTO
  // negozio; un conto vero collegato con «Ho già un account» entra solo con la sua sessione gia' aperta, o mette
  // la password (decisione di Lorenzo del 21/10/2026, lib/accesso-cliente.ts). Se nel browser c'e' la sessione
  // di un'altra persona, prima dell'ingresso automatico si chiede conferma (lib/accesso-cliente.ts).
  // L'accesso automatico usa l'utente di login del cliente, non clienti.email (NMC-14). Fino al 20/10/2026 qui
  // il magic link si chiedeva per clienti.email: se e' l'email di login di un altro utente si entrava come
  // lui; se non ha un utente, generateLink lo crea, orfano e senza riga in `utenti` (portale senza menu), e da
  // li' l'installazione non riesce piu' a dare l'accesso al conto, perche' l'email risulta gia' presa. Il
  // conto nato dall'installazione rimasto senza accesso riparte dall'OAuth (il ripiego): e' li' che l'accesso
  // rinasce (lib/shopifyProvision.ts, assicuraAccesso).
  return entraNelPortaleDaShopify(req, admin, { clienteId: String(integr!.cliente_id), shop, ripiego: autorizza })
}
