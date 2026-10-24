import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { trovaContoDelNegozio } from '@/lib/shopifyProvision'
import { SHOPIFY_SCOPES_ESSENZIALI } from '@/lib/shopify'
import { verificaLinkShopify } from '@/lib/shopifyFirma'
import { conErrore, conCollegato, type CodiceErrore } from '@/lib/esiti-collegamento'
import { clienteDellaSessione, entraNelPortaleDaShopify } from '@/lib/accesso-cliente'
import { DURATA_STATO_MS, azzeraNonceShopify, eNegozioShopify, verificaNonceShopify } from '@/lib/shopifyOAuth'
import {
  PAGINA_SCELTA, cancellaSospesiDelNegozio, collegaNegozioShopify, conCookieSospeso, pulisciSospesiScaduti,
  salvaSospesoShopify, type CredenzialiNegozio,
} from '@/lib/shopifyCollega'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// OGNI USCITA D'ERRORE DI QUESTA ROTTA E' UN REDIRECT CON UN CODICE, MAI UNA FRASE NE' UN JSON.
// Fino al 20/10/2026 nell'indirizzo finivano frasi italiane e perfino il testo dell'errore del database
// (il codice cliente gia' preso di NMC-1), e tre rami rispondevano JSON 400/500: per chi installa sono
// pagine d'errore, per Shopify un motivo di rifiuto. Il codice lo traduce lib/esiti-collegamento.ts,
// in un posto solo per tutte le pagine; il motivo tecnico va nei log, non al negoziante.
//
// IL NONCE dell'autorizzazione (lib/shopifyOAuth.ts) vale un giro solo, e lo cancella il giro a cui appartiene:
// ogni uscita lo cancella, ma solo da quando il nonce ha passato la verifica qui sotto. Fino al 21/10/2026 lo
// cancellava ogni uscita, anche quella di un ritorno che non era il suo: con due giri insieme nello stesso
// browser (due schede, un doppio clic) il cookie e' quello dell'ultimo avvio, il primo ritorno lo trovava
// diverso dal suo state, lo cancellava, e al secondo ritorno il nonce non c'era piu': fallivano tutti e due.
// Per lo stesso motivo non lo tocca un ritorno incompleto o con la firma falsa: non e' il suo giro.
//
// Gli indirizzi si costruiscono sull'host di questa richiesta: e' quello a cui il browser ha mandato il nonce e
// a cui mandera' il cookie dell'installazione in sospeso. Prima alcuni rami usavano SHOPIFY_APP_URL: con un host
// diverso il cookie appena scritto non sarebbe arrivato alla pagina della scelta.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const shop = (sp.get('shop') || '').toLowerCase()
  const code = sp.get('code') || ''
  const state = sp.get('state') || ''

  let nonceVerificato = false
  const chiudi = (risposta: NextResponse) => nonceVerificato ? azzeraNonceShopify(risposta) : risposta
  const vai = (percorso: string) => chiudi(NextResponse.redirect(new URL(percorso, req.url)))
  const errore = (percorso: string, codice: CodiceErrore) => vai(conErrore(percorso, codice))

  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiKey || !apiSecret) {
    console.error('[SHOPIFY][CALLBACK] variabili SHOPIFY_API_KEY/SHOPIFY_API_SECRET assenti')
    return errore('/cliente', 'shopify_non_configurato')
  }
  // Senza negozio, code o state non e' un ritorno di Shopify che si possa verificare: per chi lo apre
  // vale la stessa indicazione della firma (riaprire l'app dall'admin del negozio).
  if (!eNegozioShopify(shop) || !code || !state) {
    console.warn('[SHOPIFY][CALLBACK] richiesta incompleta', eNegozioShopify(shop) ? shop : '(negozio assente o non valido)')
    return errore('/cliente', 'firma')
  }
  // La firma la verifica lib/shopifyFirma.ts, la stessa regola di /enter. Il tempo qui non ferma niente,
  // di proposito: il riuso di questo indirizzo lo bloccano lo state monouso e la sua scadenza (qui sotto), e
  // chi ricarica la pagina dopo il collegamento deve continuare a finire su ?connected anche se sono passati
  // minuti.
  if (verificaLinkShopify(sp, apiSecret).esito === 'firma_falsa') {
    console.warn('[SHOPIFY][CALLBACK] firma non valida', shop)
    return errore('/cliente', 'firma')
  }

  // Il client di servizio: shopify_oauth_state, shopify_pending e le credenziali sono chiuse ad anon e
  // authenticated, e al ritorno cross-site dall'OAuth il cookie di sessione puo' mancare. L'autorizzazione a
  // scrivere non viene dai cookie: viene dallo state validato e consumato qui sotto, e per un negozio nuovo
  // dalla scelta esplicita del negoziante (app/api/integrazioni/shopify/collega).
  const admin = createAdminSupabase()

  // UN GIRO CHE NON E' DI QUESTO BROWSER, O NON E' PIU' VIVO, NON SCAMBIA IL CODICE.
  // Lo scambio ritira subito il refresh token che il negozio ha gia' (guida Shopify, access tokens): farlo per
  // un giro da rifiutare romperebbe il collegamento del proprietario. Resta l'idempotenza del ricaricamento:
  // chi ricarica questo indirizzo dopo un collegamento riuscito non trova piu' ne' nonce ne' state, e se il
  // negozio e' collegato AL CLIENTE DI QUESTO BROWSER vede «collegato» invece di un errore. Mai per una riga
  // attiva trovata col solo dominio: puo' essere di un altro cliente (lib/esiti-collegamento.ts, conCollegato).
  // Il nonce resta dov'e' se la verifica non e' passata (chiudi, qui sopra): se c'e' ma e' diverso dallo state,
  // e' di un altro giro ancora in corso, che deve poter finire.
  const giroNonValido = async (motivo: string) => {
    console.warn('[SHOPIFY][CALLBACK] giro non valido, codice non scambiato:', motivo, shop)
    const chi = await clienteDellaSessione(admin)
    if (chi) {
      const { data: gia } = await admin.from('integrazioni').select('id')
        .eq('piattaforma', 'shopify').eq('identificativo', shop).eq('cliente_id', chi.clienteId).eq('stato', 'attivo').maybeSingle()
      if (gia?.id) return vai(conCollegato('/cliente/integrazioni', shop as `${string}.myshopify.com`))
    }
    return errore('/cliente', 'collegamento_scaduto')
  }

  // Il nonce: il cookie scritto da /enter su QUESTO browser deve essere uguale allo state (guida Shopify
  // sull'authorization code grant). Un indirizzo d'autorizzazione fatto approvare in un altro browser torna
  // senza: e' il modo in cui un cliente si faceva agganciare il negozio di un altro (lib/shopifyOAuth.ts).
  if (!verificaNonceShopify(req, state)) return giroNonValido('nonce assente o diverso dallo state')
  // Da qui il giro e' di questo browser: comunque finisca, il suo nonce non serve piu'.
  nonceVerificato = true

  // Lo state si consuma in UN'istruzione sola (delete con select): due ritorni con lo stesso indirizzo non
  // passano tutti e due. Non porta ne' cliente ne' master (lib/shopifyOAuth.ts): per un negozio gia' noto
  // decide la sua riga, per uno nuovo la scelta del negoziante. Uno scritto prima del 21/10/2026, che li porta,
  // non cambia niente: qui se ne legge solo la data.
  const { data: consumati, error: eState } = await admin.from('shopify_oauth_state').delete()
    .eq('state', state).eq('shop', shop).select('created_at')
  if (eState) {
    console.error('[SHOPIFY][CALLBACK] lettura dello state non riuscita', shop, eState.message)
    return errore('/cliente', 'ingresso_non_riuscito')
  }
  const st = consumati?.[0]
  if (!st) return giroNonValido('state assente, gia\' usato o di un altro negozio')
  // Dieci minuti, come Amazon: il giro vero dura secondi. Uno state piu' vecchio e' un giro abbandonato.
  if (!(Date.now() - new Date(st.created_at).getTime() <= DURATA_STATO_MS)) return giroNonValido('state scaduto')

  // GLI STATE SHOPIFY SCADUTI SI TOLGONO. Nessuno li puliva: il 21/10/2026 ce n'erano 522, dal 13/07, tutti
  // oltre i dieci minuti e quindi ormai inservibili. Solo i domini *.myshopify.com: la tabella tiene anche gli
  // state di eBay ('ebay') e TikTok ('tiktok'), che hanno le loro regole. Dopo la risposta, per non far
  // aspettare chi installa.
  after(async () => {
    const soglia = new Date(Date.now() - DURATA_STATO_MS).toISOString()
    const { error } = await admin.from('shopify_oauth_state').delete().like('shop', '%.myshopify.com').lt('created_at', soglia)
    if (error) console.error('[SHOPIFY][CALLBACK] pulizia degli state scaduti non riuscita', error.message)
  })

  // Scambia code -> access token OFFLINE A SCADENZA (`expiring=1`). Shopify NON accetta piu' i
  // token offline non-scadenti sull'Admin API (risponde 403 "Non-expiring access tokens are no
  // longer accepted"). Con `expiring=1` la risposta porta access_token + expires_in + refresh_token:
  // il token si rinnova col refresh (vedi getValidShopifyToken), non si "rompe". Al refresh Shopify
  // INVALIDA il vecchio refresh_token, quindi va sempre salvato quello nuovo.
  let credenziali: CredenzialiNegozio
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code, expiring: '1' }),
    })
    const raw = await r.text()
    let d: any = null
    try { d = JSON.parse(raw) } catch {}
    if (!r.ok || !d) throw new Error(`HTTP ${r.status} — risposta non valida da Shopify`)
    if (!d.access_token) throw new Error('nessun access_token ricevuto')
    const now = Date.now()
    credenziali = {
      access_token: String(d.access_token),
      scope: String(d.scope || ''),
      refresh_token: String(d.refresh_token || ''),
      expires_at: d.expires_in ? now + Number(d.expires_in) * 1000 : null,
      refresh_expires_at: d.refresh_token_expires_in ? now + Number(d.refresh_token_expires_in) * 1000 : null,
      autorizzato_il: new Date(now).toISOString(),
    }
  } catch (e: any) {
    console.error('[SHOPIFY][CALLBACK] scambio token', shop, e?.message || e)
    // Non un 502 JSON grezzo (sembra "l'app non funziona"): pagina utile per riprovare.
    return errore('/cliente', 'collegamento_token')
  }

  // COSA HA CONCESSO DAVVERO IL NEGOZIANTE.
  //
  // Shopify torna qui l'elenco degli scope concessi, e finora lo salvavamo senza guardarlo. Ma il
  // negoziante puo' concederne meno di quelli chiesti, e la doc lo dice esplicitamente ("Merchants
  // can modify requested scopes during authorization, so always verify before storing the token").
  // Un negozio salvato 'attivo' con un token che non vede i fulfillment order e' un negozio dove
  // ogni evasione muore in silenzio: da fuori sembra collegato, e gli ordini restano Unfulfilled
  // per sempre. Meglio dirlo subito e far rifare il collegamento.
  // Si guardano i write_*, non i read_*: un write include gia' il suo read e nella lista dei
  // concessi torna il write.
  const concessi = credenziali.scope.split(',').map((x) => x.trim())
  const mancanti = SHOPIFY_SCOPES_ESSENZIALI.filter((x) => !concessi.includes(x))
  if (mancanti.length) {
    // Quali permessi mancano lo dice il log, non l'indirizzo.
    console.error('[SHOPIFY][CALLBACK] scope insufficienti', shop, credenziali.scope, 'mancano:', mancanti.join(','))
    return errore('/cliente/integrazioni', 'permessi_mancanti')
  }

  // NEGOZIO GIA' LEGATO A UN CONTO: si riaggancia li', senza domande.
  //
  // La riga del negozio in qualunque stato (dopo una disinstallazione resta 'disconnesso' col suo cliente),
  // oppure il conto nato dall'installazione ritrovato per indirizzo dopo uno shop/redact
  // (lib/shopifyProvision.ts). Chi reinstalla rientra subito (requisito 2.3.4). Il cliente gia' entrato in
  // questo browser non conta: il negozio va al SUO conto, e chi ci entra lo decide l'ingresso (regola D5):
  // da solo solo il conto nato da Shopify, un conto vero con la sua sessione o con la password. Fino al
  // 21/10/2026 qui si guardava il cliente dello state, cioe' la sessione di /enter: con un ALTRO cliente nel
  // browser il ritorno rifiutava il negozio dopo aver gia' scambiato il codice, e il token del proprietario
  // moriva. Il token nuovo va sulla riga del proprietario (lib/shopifyCollega.ts, la regola unica).
  const conto = await trovaContoDelNegozio(admin, shop)
  if (conto && 'error' in conto) {
    // Fino al 20/10 questo ramo non scriveva niente nei log e metteva nell'indirizzo il testo del
    // database: cosi' NMC-1 (ogni negozio nuovo respinto) e' rimasto invisibile per tre mesi.
    console.error('[SHOPIFY][CALLBACK] conto del negozio non determinabile', shop, conto.codice, conto.error)
    return errore('/cliente', conto.codice)
  }
  if (conto) {
    // PRIMA IL TOKEN, POI L'ACCESSO. Lo scambio del codice qui sopra ha gia' ritirato il refresh token che il
    // negozio aveva: se il conto c'e' ma il suo accesso non si e' potuto riparare (il caso vero: la riga di
    // `utenti` persa con l'utente di login rimasto, che createUser non ricrea), fino al 21/10/2026 si usciva
    // prima di salvare. Il collegamento vivo si spegneva entro un'ora, e ogni riapertura dall'admin rifaceva
    // lo stesso giro. Ora il negozio resta collegato e sincronizzato, e il negoziante legge che l'accesso
    // automatico non e' riuscito. Non si scrive niente solo quando il conto non deve ricevere il negozio:
    // lo decide trovaContoDelNegozio, che allora risponde con un errore (qui sopra).
    const esito = await collegaNegozioShopify(admin, { shop, clienteId: conto.clienteId, credenziali })
    if (!esito.ok) return errore('/cliente', esito.codice)
    // Un'installazione in sospeso dello stesso negozio non vale piu': il suo token e' appena stato ritirato.
    after(async () => {
      const { error } = await cancellaSospesiDelNegozio(admin, shop)
      if (error) console.error('[SHOPIFY][CALLBACK] installazione in sospeso non tolta', shop, error.message)
    })
    if (conto.accesso) {
      console.error('[SHOPIFY][CALLBACK] negozio ricollegato, ma l\'accesso al conto non e\' pronto', shop, conto.clienteId, conto.accesso.error)
      return errore('/cliente', 'login_shopify')
    }
    return chiudi(await entraNelPortaleDaShopify(req, admin, { clienteId: conto.clienteId, shop }))
  }

  // NEGOZIO MAI VISTO: decide il negoziante. Il token aspetta sul server (lib/shopifyCollega.ts) e il browser
  // riceve solo un gettone in un cookie httpOnly, poi la pagina «Hai già un account MoovExpress?» (decisione D1
  // di Lorenzo del 21/10/2026). Prima qui nasceva sempre un conto nuovo sotto il master d'onboarding.
  const gettone = await salvaSospesoShopify(admin, shop, credenziali)
  if (!gettone) return errore('/cliente', 'collegamento_non_salvato')
  after(() => pulisciSospesiScaduti(admin))
  return conCookieSospeso(vai(PAGINA_SCELTA), gettone)
}
