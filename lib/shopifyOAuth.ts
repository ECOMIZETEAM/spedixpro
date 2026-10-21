import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { SHOPIFY_SCOPES } from '@/lib/shopify'
import { conErrore } from '@/lib/esiti-collegamento'

// L'AUTORIZZAZIONE DI UN NEGOZIO SHOPIFY PARTE SOLO DA QUI.
//
// Fino al 21/10/2026 partiva da /install, una rotta che chiunque poteva aprire con ?shop=<un negozio
// qualsiasi>: scriveva uno state col cliente della PROPRIA sessione dentro e rimandava all'autorizzazione di
// quel negozio. Lo state non scadeva, non era legato al browser e il callback non rileggeva la sessione: chi
// avesse fatto approvare quell'indirizzo allo staff di un altro negozio si sarebbe visto agganciare quel
// negozio al proprio conto, con gli ordini e i dati dei compratori. Il 21/10 in tabella c'erano 520 avvii
// Shopify mai conclusi, 142 su negozi inventati dalla normalizzazione del campo dominio.
//
// Ora l'autorizzazione la avvia /enter, dopo che la firma di Shopify e i 90 secondi (lib/shopifyFirma.ts)
// hanno provato che chi arriva e' stato mandato da Shopify per QUEL negozio. E lo state porta due cose che
// prima non aveva:
// - una scadenza, DURATA_STATO_MS, come gia' quello di Amazon (amazon/callback);
// - un cookie col nonce sul browser che ha aperto il giro, che al ritorno il callback deve trovare uguale allo
//   state (verificaNonceShopify). E' la verifica della guida Shopify sull'authorization code grant: lo state
//   e' un nonce da conservare "so you can verify it in the next step", e nel loro esempio sta in un cookie
//   httpOnly e SameSite=Lax. Un indirizzo d'autorizzazione approvato in un altro browser torna senza cookie.
// E non porta piu' il cliente della sessione: a chi va il negozio lo decide il callback dalla riga del
// negozio, o la scelta del negoziante per un negozio mai visto (app/api/integrazioni/shopify/callback).

// Senza prefisso __Host-: quello pretende Path=/, e questo cookie non deve viaggiare verso tutto il sito.
// __Secure- fa rifiutare al browser un cookie con questo nome scritto fuori da HTTPS.
export const COOKIE_NONCE_SHOPIFY = '__Secure-shopify-oauth-nonce'

// Dieci minuti, come lo state di Amazon: il giro vero (Shopify che autorizza e torna) dura secondi, e con
// l'installazione gestita da Shopify il consenso e' gia' dato. Uno state piu' vecchio e' un giro abbandonato
// che nessuno deve poter riprendere. Il cookie dura uguale: non sopravvive allo state che protegge.
export const DURATA_STATO_MS = 10 * 60 * 1000

// Il cookie va solo alle rotte Shopify: il callback, e la pagina della scelta dopo l'installazione.
const PERCORSO_COOKIE = '/api/integrazioni/shopify'

const NEGOZIO_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

// Il dominio che Shopify assegna al negozio. Solo questo puo' finire in un indirizzo verso Shopify.
export function eNegozioShopify(shop: string): boolean {
  return NEGOZIO_RE.test(shop)
}

// IL COLLEGAMENTO E' VIVO, O SERVE UNA NUOVA AUTORIZZAZIONE? La regola dalla riga del negozio, per /enter e
// per la conferma dell'ingresso (app/api/integrazioni/shopify/entra). Vivo vuol dire: legato a un cliente,
// 'attivo' (un rinnovo rifiutato o un 401 mettono 'errore', la disinstallazione 'disconnesso': lib/shopify.ts e
// webhooks/app-uninstalled), con un access token e un refresh token, e il refresh token non oltre la sua
// scadenza. Senza refresh token (il tipo vecchio, non scadente, che Shopify rifiuta) o con quello scaduto
// non si rinnova piu' niente. Perche' ognuna di queste condizioni c'e', lo racconta /enter.
// Dice solo cosa scrive la riga: che Shopify accetti davvero il token lo prova /enter, con una chiamata.
export function collegamentoShopifyVivo(riga: any): boolean {
  const cred = (riga?.credenziali || {}) as any
  const refreshScadeIl = Number(cred.refresh_expires_at) || 0
  return !!riga?.cliente_id && riga?.stato === 'attivo'
    && !!cred.access_token && !!cred.refresh_token
    && !(refreshScadeIl > 0 && refreshScadeIl <= Date.now())
}

// Avvia l'authorization code grant per `shop`: scrive lo state e rimanda all'authorize col cookie del nonce.
// Nello state niente cliente ne' master (qui sopra): fino al 21/10/2026 /enter ci scriveva quelli della
// sessione aperta nel browser, che il callback non legge piu', e un dato che nessuno usa e' solo un dato in
// piu' da proteggere. Ogni uscita e' un redirect, mai un JSON: per chi installa una risposta grezza e' una
// pagina rotta, e Shopify la conta come errore (requisito 2.1.1).
export async function avviaOAuthShopify(req: NextRequest, shop: string): Promise<NextResponse> {
  // Il negozio finisce nell'indirizzo del redirect: anche se chi chiama l'ha gia' controllato, un dominio
  // diverso da *.myshopify.com farebbe di questa funzione un rimando verso qualunque sito.
  if (!eNegozioShopify(shop)) {
    console.error('[SHOPIFY][OAUTH] negozio non valido, autorizzazione non avviata')
    return NextResponse.redirect(new URL(conErrore('/cliente', 'firma'), req.url))
  }
  const apiKey = process.env.SHOPIFY_API_KEY
  if (!apiKey) {
    // Config mancante: non un 500 nudo (il reviewer vedrebbe "la pagina non funziona"), ma una pagina che
    // dice cosa succede.
    console.error('[SHOPIFY][OAUTH] SHOPIFY_API_KEY assente, autorizzazione non avviata', shop)
    return NextResponse.redirect(new URL(conErrore('/cliente', 'shopify_non_configurato'), req.url))
  }
  // App URL NORMALIZZATA: niente slash finale + ripiego sull'origine. Shopify confronta il redirect_uri
  // BYTE-A-BYTE con l'allowed redirection URL: uno slash di troppo (//api), http, o www invece
  // dell'apex fa fallire l'authorize con "redirect_uri is not whitelisted" -> pagina d'errore Shopify.
  const appUrl = (process.env.SHOPIFY_APP_URL || new URL(req.url).origin).trim().replace(/\/+$/, '')
  // Il cookie lo riceve l'host di questa richiesta, e torna solo a lui. Se il ritorno dall'OAuth andasse su
  // un altro host, il callback non troverebbe il nonce e rifiuterebbe ogni collegamento, senza un motivo
  // visibile: qui almeno lo dice il log.
  try {
    if (new URL(appUrl).host !== new URL(req.url).host) {
      console.error('[SHOPIFY][OAUTH] SHOPIFY_APP_URL su un host diverso da quello della richiesta: il nonce non tornera\' al callback', new URL(appUrl).host, new URL(req.url).host)
    }
  } catch {}

  // 24 byte casuali (192 bit): sopra i 128 che la guida Security di Shopify chiede per un gettone. La tabella
  // e' chiusa (RLS + nessun grant ad anon/authenticated): la scrive il client di servizio.
  const state = crypto.randomBytes(24).toString('hex')
  const { error } = await createAdminSupabase().from('shopify_oauth_state').insert({ state, shop })
  if (error) {
    console.error('[SHOPIFY][OAUTH] state non salvato', shop, error.message)
    return NextResponse.redirect(new URL(conErrore('/cliente', 'ingresso_non_riuscito'), req.url))
  }

  const redirectUri = `${appUrl}/api/integrazioni/shopify/callback`
  const authorize =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(apiKey)}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`

  const risposta = NextResponse.redirect(authorize)
  // SameSite=Lax e non Strict: il ritorno da Shopify e' una navigazione che parte da un altro sito, e Strict
  // lo lascerebbe a casa proprio li'. Lax lo manda sulle navigazioni GET, e non sulle richieste che un altro
  // sito fa partire dalle sue pagine (moduli POST, immagini, fetch).
  risposta.cookies.set(COOKIE_NONCE_SHOPIFY, state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: PERCORSO_COOKIE, maxAge: DURATA_STATO_MS / 1000,
  })
  return risposta
}

// Il ritorno da Shopify arriva dallo stesso browser che ha aperto il giro? Il cookie deve essere uguale allo
// state dell'indirizzo. Confronto a tempo costante sulle impronte: le lunghezze sono uguali per costruzione
// (timingSafeEqual altrimenti lancia), e dal tempo di risposta non si ricava niente del cookie.
export function verificaNonceShopify(req: NextRequest, state: string): boolean {
  const nonce = req.cookies.get(COOKIE_NONCE_SHOPIFY)?.value || ''
  if (!nonce || !state) return false
  const impronta = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest()
  return crypto.timingSafeEqual(impronta(nonce), impronta(state))
}

// Il nonce vale un giro: il callback lo cancella sulla risposta che restituisce, ma solo dopo che ha passato
// la verifica, cioe' solo se il giro e' il suo. Un nonce diverso dallo state e' di un altro giro ancora in
// corso nello stesso browser (due schede, un doppio clic: ogni avvio riscrive il cookie), e cancellarlo
// faceva fallire anche quello (app/api/integrazioni/shopify/callback, giroNonValido).
// Va cancellato con lo stesso percorso con cui e' stato scritto, altrimenti il browser se lo tiene.
export function azzeraNonceShopify(risposta: NextResponse): NextResponse {
  risposta.cookies.set(COOKIE_NONCE_SHOPIFY, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: PERCORSO_COOKIE, maxAge: 0,
  })
  return risposta
}
