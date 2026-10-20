import { createServerSupabase } from '@/lib/supabase'
import { ESITI_EVASIONE, MAX_TENTATIVI_NEGOZIO, STATI_SPEDIZIONE_IN_ANNULLO, righeDaEvadere, spedizioneDelPacco } from '@/lib/evasione-ordini'
import { assorbitiDi } from '@/lib/ordini-uniti'

const API_VERSION = '2026-04'

// SCOPE OAUTH — FONTE UNICA.
//
// La stessa stringa serve in due posti: shopify.app.toml (quella che Shopify pubblica, approva e
// mostra al negoziante) e il parametro `scope` dell'authorize URL costruito da install/route.ts.
// Finche' erano due copie battute a mano combaciavano per fortuna, non per costruzione: chi
// correggeva l'una e non l'altra collegava male i negozi senza che nessuno se ne accorgesse.
//
// Perche' TRE e non sette. Un `write_*` include gia' il suo `read_*` (doc access-scopes: "Any
// permission to write a resource includes permission to read it, so request the write scope only
// when your app needs both"), quindi i tre `read_*_fulfillment_orders` erano rumore che allungava
// la schermata di consenso. E gli `*_assigned_fulfillment_orders` sono per i FULFILLMENT SERVICE,
// cioe' le app che gestiscono un magazzino per conto del negozio: noi non ne abbiamo uno, e dal
// 1/2/2025 la review toglie da sola gli scope che l'app non usa. Chiedere permessi che non servono
// e' un rilievo gratuito.
//
// La riduzione NON richiede un nuovo consenso ai negozi gia' installati (doc manage-access-scopes:
// "If the change reduces scopes, the merchant isn't prompted").
export const SHOPIFY_SCOPES = 'read_orders,write_merchant_managed_fulfillment_orders,write_third_party_fulfillment_orders'

// Quelli senza i quali l'app non funziona, per controllare cosa il negoziante ha DAVVERO concesso
// al ritorno dall'OAuth. Si guardano i `write_*`, non i `read_*`: la doc dice che nella lista dei
// concessi torna il write, non un read separato.
export const SHOPIFY_SCOPES_ESSENZIALI = ['read_orders', 'write_merchant_managed_fulfillment_orders']

// ── TOKEN OAUTH: è QUESTO il token buono ────────────────────────────────────
// È quello che il negoziante ha autorizzato con i permessi che ha concesso (ordini compresi).
// Va usato per primo, sempre. Il token coniato con client_credentials è un ripiego temporaneo
// (24h) e NON porta con sé l'autorizzazione del negoziante: usandolo al posto di questo si
// finisce per chiedere gli ordini senza averne il diritto, e Shopify risponde 403.
// Si usa il token SOLO se ha una scadenza ancora valida. Un token NON-SCADENTE (expiresAt null,
// il vecchio tipo) Shopify ora lo RIFIUTA con 403 ("Non-expiring access tokens are no longer
// accepted"): va rinnovato col refresh (getValidShopifyToken). Prima qui `!expiresAt` lo
// restituiva com'era — ed era la causa del 403 sulle integrazioni collegate col vecchio flusso.
//
// E' una funzione a parte perche' la usa anche la simulazione dell'annullo, che il token NON deve
// rinnovarlo: il rinnovo riscrive le credenziali e fa ruotare il refresh token su Shopify, in
// concorrenza coi lavori di produzione. Cosi' la regola "il token e' ancora buono" sta in un posto.
export function tokenValidoSenzaRinnovo(integrazione: any): string | null {
  const cred = (integrazione?.credenziali || {}) as any
  const token = cred.access_token
  const expiresAt = cred.expires_at ? Number(cred.expires_at) : null
  return token && expiresAt && expiresAt - Date.now() > 5 * 60 * 1000 ? String(token) : null
}

// Restituisce un access token Shopify valido per l'integrazione data.
// Se il token e' scaduto (o sta per scadere), lo rifresca col refresh token
// e aggiorna le credenziali salvate. Ritorna { token } oppure { error }.
export async function getValidShopifyToken(integrazione: any, db?: any): Promise<{ token?: string; error?: string }> {
  const cred = (integrazione?.credenziali || {}) as any
  const shop = cred.shop || integrazione?.identificativo
  const refreshToken = cred.refresh_token

  if (!shop) return { error: 'Credenziali Shopify mancanti' }

  const valido = tokenValidoSenzaRinnovo(integrazione)
  if (valido) return { token: valido }

  // Token scaduto (o vecchio non-scadente ormai rifiutato): si rinnova col refresh token
  // (grant_type=refresh_token, expiring=1 — vedi sotto). Se il refresh token non c'e' (tipico dei
  // collegamenti fatti PRIMA del passaggio ai token scadenti), non c'è nulla da rinnovare: si chiede
  // di ricollegare il negozio. NB: i nuovi collegamenti chiedono `expiring=1` nello scambio token
  // (callback), come da doc Shopify — NON `grant_options[]=expiring` nell'authorize (non esiste).
  if (!refreshToken) {
    return { error: 'Sessione Shopify scaduta. Ricollega il negozio dalle Integrazioni.' }
  }
  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        expiring: '1',
      }),
    })
    const raw = await r.text()
    let d: any = null
    try { d = JSON.parse(raw) } catch {}
    if (!r.ok || !d?.access_token) {
      return { error: 'Sessione Shopify scaduta. Ricollega il negozio dalle Integrazioni.' }
    }

    const n = Date.now()
    const newCred = {
      ...cred,
      access_token: d.access_token,
      refresh_token: d.refresh_token || refreshToken,
      expires_at: d.expires_in ? n + Number(d.expires_in) * 1000 : null,
      refresh_expires_at: d.refresh_token_expires_in ? n + Number(d.refresh_token_expires_in) * 1000 : cred.refresh_expires_at,
    }
    const supabase = db || await createServerSupabase()
    await supabase.from('integrazioni').update({ credenziali: newCred }).eq('id', integrazione.id)
    return { token: d.access_token }
  } catch (e: any) {
    return { error: 'Errore refresh token: ' + (e?.message || e) }
  }
}

export { API_VERSION }

// Helper per la GraphQL Admin API (obbligatoria per le app pubbliche).
export async function shopifyGraphQL(shop: string, token: string, query: string, variables?: any, tentativo = 0): Promise<any> {
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} }),
  })
  const raw = await r.text()
  let d: any = null
  try { d = JSON.parse(raw) } catch {}
  // 401 e 403 sono due problemi DIVERSI e vanno detti diversamente: prima finivano nello stesso
  // messaggio (che parlava di dati protetti) e la risposta vera di Shopify veniva buttata via,
  // quindi non si capiva mai quale dei due fosse. Ora si registra il corpo dell'errore.
  if (r.status === 401) {
    console.error('[SHOPIFY][401]', shop, raw.slice(0, 300))
    throw new Error('Il collegamento con Shopify non è più valido (sessione scaduta o app disinstallata dal negozio). Ricollega il negozio dalle Integrazioni.')
  }
  if (r.status === 403) {
    console.error('[SHOPIFY][403]', shop, raw.slice(0, 300))
    throw new Error('Shopify ha negato la lettura degli ordini (403): l\'app non ha l\'accesso approvato ai dati protetti del cliente (nome, indirizzo, email, telefono). Va richiesto nel Partner Dashboard, in API access → Protected customer data. Sui negozi di sviluppo funziona anche senza, sugli altri no.')
  }
  if (r.status === 429) {
    // Limite di chiamate: e' un'attesa, non un guasto. Vale la stessa ragione del THROTTLED qui sotto.
    if (tentativo < 2) { await attendi(1200 * (tentativo + 1)); return shopifyGraphQL(shop, token, query, variables, tentativo + 1) }
  }
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${raw.slice(0, 150)}`)
  if (d?.errors) {
    // THROTTLED NON E' UN ERRORE DELL'ORDINE: e' "riprova fra un attimo".
    //
    // Shopify risponde 200 con errors[] quando si sfora il budget di chiamate. Finiva dritto nel
    // catch di chi chiama, che segnava l'ordine 'errore' e bruciava uno degli 8 tentativi del
    // recupero — proprio nel momento peggiore, cioe' quando si spediscono piu' ordini insieme sullo
    // stesso negozio (il revisore fa esattamente questo). Qui si aspetta e si ritenta.
    const throttled = Array.isArray(d.errors) &&
      d.errors.some((e: any) => String(e?.extensions?.code || '').toUpperCase() === 'THROTTLED')
    if (throttled && tentativo < 2) {
      await attendi(1500 * (tentativo + 1))
      return shopifyGraphQL(shop, token, query, variables, tentativo + 1)
    }
    const msg = Array.isArray(d.errors) ? d.errors.map((e: any) => e.message).join('; ') : JSON.stringify(d.errors)
    throw new Error('Shopify: ' + String(msg).slice(0, 220))
  }
  return d?.data
}

const attendi = (ms: number) => new Promise((res) => setTimeout(res, ms))

// Rimanda il tracking a Shopify (fulfillment) per le spedizioni date.
// Chiamata alla CHIUSURA DISTINTA. Best-effort: mai bloccante, salva esito per ordine.
// supabase: client gia' pronto (server o admin - nel cron passare l'admin).
export async function fulfillSpedizioniShopify(supabase: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  // Quali righe evadere lo decide lib/evasione-ordini: le collegate alla spedizione e, per gli ordini
  // uniti, gli assorbiti del pacco, ognuno con la SUA evasione ma col tracking del capofila
  // (fulfillmentCreate vale per un ordine solo). Se la lettura fallisce si lancia: fulfillMarketplace
  // lo scrive nel log e il recupero ritenta.
  const righe = await righeDaEvadere(supabase, spedizioneIds, 'shopify')
  for (const { ordine, spedizioneId, nelPacco } of righe) {
    if (ordine.fulfillment_stato === 'ok') continue
    const segna = async (stato: string, errore: string | null) => {
      await supabase.from('ordini_ecommerce')
        .update({ fulfillment_stato: stato, fulfillment_errore: errore })
        .eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      const { data: sped } = await supabase
        .from('spedizioni').select('tracking_number, tracking_token, stato, corrieri(nome_contratto)')
        .eq('id', spedizioneId).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      // Lo stato si rilegge QUI, non solo all'ingresso: fra la chiamata e questo punto la spedizione
      // puo' essere stata annullata (la spinta gira in after(), dopo la risposta). Evaderla adesso
      // vorrebbe dire mandare al compratore l'email di spedizione con un tracking gia' morto.
      if (STATI_SPEDIZIONE_IN_ANNULLO.includes(String((sped as any)?.stato || ''))) continue
      const company = (sped as any)?.corrieri?.nome_contratto || 'Altro'
      // L'integrazione per id oppure, per una riga rimasta orfana di un ricollegamento, quella
      // attiva dello stesso negozio e cliente: prima una riga orfana finiva in 'errore' per sempre.
      const integr = await integrazioneDellaRiga(supabase, ordine)
      const shop = (integr?.credenziali as any)?.shop
      if (!integr || !shop) { await segna('errore', 'integrazione non trovata'); continue }
      // Si passa il client GIA' pronto (nel cron e' l'admin/service_role): senza, getValidShopifyToken
      // ripiega su createServerSupabase (user-scoped) e nel cron — che non ha sessione — la RLS blocca
      // il salvataggio del token rinnovato. Shopify invalida il vecchio refresh_token appena lo usi:
      // se il nuovo non si salva, al giro dopo il refresh fallisce e il negozio "si scollega" da solo.
      const tk = await getValidShopifyToken(integr, supabase)
      if (tk.error || !tk.token) { await segna('errore', tk.error || 'token non disponibile'); continue }
      const token = tk.token
      // 1) fulfillment orders dell'ordine (GraphQL)
      //
      // `first: 50`, non 10: oltre il decimo la lista si troncava e i fulfillment order rimasti
      // fuori sembravano non esistere.
      //
      // Si chiedono anche `supportedActions`, `assignedLocation` e `cancelledAt` perche' senza quei
      // tre campi si prendevano tre decisioni al buio (vedi sotto, nell'ordine): se l'ordine esiste
      // ancora, chi deve evadere il fulfillment order, e quante mutation servono. E le evasioni gia'
      // presenti (`fulfillments`), per riconoscere quella di una nostra spedizione annullata.
      const gid = `gid://shopify/Order/${ordine.ordine_esterno_id}`
      const leggiOrdine = async () => (await shopifyGraphQL(shop, token,
        `query($id: ID!){ order(id:$id){ cancelledAt displayFulfillmentStatus fulfillmentOrders(first:50){ edges{ node{ id status supportedActions{ action } assignedLocation{ name address1 zip } } } } fulfillments(first:50){ id status trackingInfo{ number url } } } }`,
        { id: gid }) as any)?.order
      let ord = await leggiOrdine()

      // ORDINE ANNULLATO SULLO STORE: non e' un guasto nostro, e non si sistemera' mai.
      // Prima finiva in 'errore' con "nessun fulfillment order da evadere": badge arancione "Store
      // non aggiornato" acceso per sempre su un ordine che il negoziante ha annullato lui, e otto
      // giri di recupero sprecati su un caso definitivo. Il testo e' quello del badge rosso in pagina.
      if (ord?.cancelledAt || String(ord?.displayFulfillmentStatus || '') === 'RESTOCKED') {
        await segna('annullato_store', testoAnnullatoStore(!!nelPacco))
        continue
      }

      // L'EVASIONE DI UNA NOSTRA SPEDIZIONE ANNULLATA SI TOGLIE PRIMA DI DECIDERE.
      //
      // Se l'ordine viene rispedito dopo un annullo, su Shopify c'e' ancora l'evasione col tracking
      // morto: l'ordine risulta FULFILLED e qui sotto finiva in 'ok, gia evaso su Shopify', cioe' il
      // tracking NUOVO non arrivava mai al compratore. Si annullano solo le evasioni riconosciute come
      // nostre e morte (classificaEvasioni); quelle del negoziante o di altre app non si toccano.
      let annullateOra = false
      const nostre = await evasioniNostre(supabase, ordine.cliente_id, ord?.fulfillments || [])
      const prima = classificaEvasioni(ord?.fulfillments || [], nostre)
      if (prima.morte.length) {
        const { rifiuti } = await annullaEvasioni(shop, token, prima.morte)
        ord = await leggiOrdine()
        const ancoraAttive = rifiutiVeri(rifiuti, ord)
        if (ancoraAttive.length) {
          await segna('errore', `${PREFISSO_ANNULLO} non riuscito: ${ancoraAttive.join(' | ')}`.slice(0, 200))
          continue
        }
        annullateOra = true
      }
      const stato = String(ord?.displayFulfillmentStatus || '')
      const tutti = ((ord?.fulfillmentOrders?.edges) || []).map((e: any) => e.node)
      const azioni = (f: any) => ((f?.supportedActions) || []).map((x: any) => String(x?.action || ''))

      // CHI PUO' EVADERE COSA LO DICE SHOPIFY, non il nostro elenco di status.
      //
      // Prima si filtrava a mano su ['OPEN','IN_PROGRESS','SCHEDULED']. Il criterio documentato e'
      // un altro: `supportedActions`. CREATE_FULFILLMENT = lo evadiamo noi; REQUEST_FULFILLMENT =
      // il fulfillment order sta su una location gestita da un servizio di evasione esterno (3PL), e
      // li' l'evasione la crea LORO, non noi — chiamarci fulfillmentCreate sopra e' proprio
      // l'operazione sbagliata. Passando alle azioni cadono da soli anche gli SCHEDULED (differiti:
      // vanno aperti prima, non evasi) e i FO gia' chiusi.
      const evadibili = tutti.filter((f: any) => azioni(f).includes('CREATE_FULFILLMENT'))
      const daTerzi = tutti.filter((f: any) => !azioni(f).includes('CREATE_FULFILLMENT') && azioni(f).includes('REQUEST_FULFILLMENT'))
      // INCOMPLETE compreso: e' un'evasione che non si e' potuta completare come richiesta, e la
      // sblocca il negoziante — non noi.
      const trattenuti = tutti.filter((f: any) => ['ON_HOLD', 'SCHEDULED', 'INCOMPLETE'].includes(f.status))

      if (!evadibili.length) {
        // Abbiamo appena tolto un'evasione nostra morta e Shopify non ha (ancora) riaperto niente da
        // evadere: ne' 'ok' ne' 'esterno', che per il recupero sono finali. Shopify puo' ricreare i
        // fulfillment order anche in un'altra location (doc di fulfillmentCancel): si riprova.
        if (annullateOra) {
          await segna('errore', "evasione col tracking annullato tolta: Shopify non ha ancora riaperto l'ordine, riproviamo")
          continue
        }
        // QUI STAVA LA BOCCIATURA 2.1.4, ed era invisibile.
        //
        // Prima: nessun fulfillment order evadibile => `ok, gia evaso su Shopify`. Ma "non
        // evadibile" NON vuol dire "evaso": nell'enum di Shopify `ON_HOLD` significa che l'evasione
        // e' TRATTENUTA e `INCOMPLETE` che non si puo' completare come richiesto. In quei casi
        // l'ordine sull'admin resta Unfulfilled — e noi lo marcavamo 'ok', quindi il recupero
        // automatico non lo riprendeva piu' (salta gli 'ok'). Il merchant vedeva "spedito" da noi e
        // "Unfulfilled" su Shopify, per sempre. E' esattamente cio' che ha visto il revisore.
        //
        // Ora la verita' la dice Shopify: si guarda `displayFulfillmentStatus` dell'ORDINE.
        if (stato === 'FULFILLED') { await segna('ok', 'gia evaso su Shopify'); continue }
        if (trattenuti.length) {
          // 'attesa', NON 'errore'. Aspettiamo il negoziante (blocco antifrode, richiesta del
          // compratore, evasione differita): non abbiamo sbagliato niente noi. Con 'errore' il
          // recupero consumava uno degli otto tentativi ogni 20 minuti e si arrendeva dopo ~2h40 —
          // su un blocco che dura giorni. Lo stato dedicato lo lascia in coda senza bruciare
          // tentativi, come si fa gia' per le LDV provvisorie.
          const quali = Array.from(new Set(trattenuti.map((f: any) => f.status))).join(', ')
          await segna('attesa', `evasione trattenuta su Shopify (${quali}): riproviamo da soli appena e' sbloccata`)
          continue
        }
        if (daTerzi.length) {
          // Non e' una cosa che possiamo fare noi: la merce sta in un magazzino gestito da un
          // servizio esterno, che deve creare lui l'evasione. Si dice al negoziante con parole sue,
          // e non si ritenta all'infinito.
          await segna('esterno', 'questo ordine e\' affidato a un servizio di evasione esterno del negozio: l\'evasione la registra quel servizio')
          continue
        }
        // Nessun fulfillment order evadibile, nessuno trattenuto e l'ordine non risulta evaso:
        // caso strano (righe tutte rimosse). Si lascia detto cosa si e' visto invece di dichiarare
        // un successo che non c'e'.
        await segna('errore', `nessun fulfillment order da evadere (ordine: ${stato || 'stato sconosciuto'})`)
        continue
      }
      // 2) crea il fulfillment con il tracking — UNA MUTATION PER LOCATION.
      //
      // `fulfillmentCreate`, NON `fulfillmentCreateV2`: quest'ultima e' DEPRECATA da Shopify ("Use
      // fulfillmentCreate instead"). Funziona ancora, ma su una app in revisione una chiamata
      // deprecata e' un rilievo gratuito — e prima o poi viene rimossa e l'evasione si ferma.
      //
      // RAGGRUPPATI PER LOCATION: la doc di fulfillmentCreate dice che i fulfillment order devono
      // essere "assigned to the same Location". Shopify spezza un ordine in piu' FO da solo quando
      // lo stock sta in magazzini diversi, senza che il negoziante faccia niente. Infilandoli tutti
      // in una sola mutation, come si faceva, la chiamata falliva INTERA: l'ordine restava
      // Unfulfilled anche per la parte che si poteva evadere benissimo.
      //
      // URL DI TRACCIAMENTO: senza, il numero NON e' cliccabile per il compratore. Shopify lo rende
      // cliccabile solo se gli si passa un `url`, oppure un nome corriere che conosce LUI, preso
      // dalla sua lista: il nostro `nome_contratto` (es. "Poste Express M") per Shopify non vuole
      // dire niente. Gli diamo la nostra pagina pubblica di tracciamento, che e' brandizzata col
      // master e mostra lo stato aggiornato — meglio del sito del corriere, e non nomina il provider.
      const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
      const urlTracking = (sped as any)?.tracking_token ? `${base}/traccia/${(sped as any).tracking_token}` : undefined
      // La location si identifica con i suoi campi SCALARI (nome + indirizzo), non con
      // `assignedLocation.location.id`: quello e' un oggetto Location e richiederebbe lo scope
      // read_locations, che non chiediamo e non serve — chiederne uno in piu' solo per raggruppare
      // sarebbe esattamente il permesso di troppo che la review toglie.
      const perLocation = new Map<string, any[]>()
      for (const f of evadibili) {
        const a = f?.assignedLocation || {}
        const loc = [a.name, a.address1, a.zip].filter(Boolean).join('|') || 'senza-location'
        perLocation.set(loc, [...(perLocation.get(loc) || []), f])
      }
      const falliti: string[] = []
      for (const gruppo of Array.from(perLocation.values())) {
        const dF = await shopifyGraphQL(shop, tk.token,
          `mutation($f: FulfillmentInput!){ fulfillmentCreate(fulfillment:$f){ fulfillment{ id status } userErrors{ field message } } }`,
          { f: {
              notifyCustomer: true,
              trackingInfo: { number: tracking, company, ...(urlTracking ? { url: urlTracking } : {}) },
              lineItemsByFulfillmentOrder: gruppo.map((f: any) => ({ fulfillmentOrderId: f.id })),
          } })
        const errs = dF?.fulfillmentCreate?.userErrors || []
        if (errs.length) falliti.push(errs.map((e: any) => e.message).join('; '))
      }
      // 'ok' SOLO se e' andato tutto. Con un gruppo fallito o un fulfillment order ancora trattenuto,
      // sullo store resta della merce non evasa: dichiararlo 'ok' vorrebbe dire toglierlo dal
      // recupero e non tornarci mai piu' (e' lo stesso modo di sbagliare della bocciatura 2.1.4).
      // L'idempotenza regge: al giro dopo i FO gia' evasi sono chiusi e non rientrano fra gli
      // evadibili, quindi si ritenta solo cio' che manca davvero.
      if (falliti.length) { await segna('errore', falliti.join(' | ').slice(0, 200)); continue }
      if (trattenuti.length) {
        const quali = Array.from(new Set(trattenuti.map((f: any) => f.status))).join(', ')
        await segna('attesa', `evasa la parte disponibile; il resto e' trattenuto su Shopify (${quali})`)
        continue
      }
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}

// ── LE EVASIONI DELLE SPEDIZIONI ANNULLATE ──────────────────────────────────────────────────────
//
// Quando una spedizione viene annullata da noi, l'ordine su Shopify restava "Fulfilled" con un
// numero di tracking che non esiste piu': il merchant vede spedito, il compratore clicca un link
// morto. E' un caso di 2.1.4 ("ensuring that all synchronized data is consistent across the Shopify
// admin, your app, and any additional platforms") preso al contrario rispetto a quello contestato:
// non un'evasione che non arriva, ma un'evasione che resta quando non dovrebbe.
//
// PERCHE' NON SI CERCA PIU' PER spedizione_id. Dall'11/09/2026 il database stacca l'ordine dalla
// spedizione nell'istante in cui questa diventa 'annullata' (trigger trg_ordine_torna_da_spedire:
// spedizione_id nullo, stato 'da_spedire', fulfillment_stato lasciato com'era, apposta). L'annullo
// cercava proprio per spedizione_id, dopo la scrittura di 'annullata', e da quel giorno non ha piu'
// trovato niente: 0 righe 'annullato' in tutta la tabella al 20/10/2026, e su Shopify gli ordini
// restavano evasi col tracking morto. Ora si parte dalla traccia che il trigger lascia: una riga
// Shopify SENZA spedizione e con un esito d'evasione (ok, attesa, errore) e' un ordine che abbiamo
// evaso e che poi e' stato staccato. Vale anche per la corsa fra le due cose: un'evasione partita
// mentre la spedizione si annullava scrive 'ok' sulla riga gia' staccata, e la riga diventa candidata.
//
// CHI LO FA. Il recupero ogni 20 minuti (app/api/integrazioni/fulfill-retry) e' la garanzia: copre
// tutte le porte che annullano, comprese le tre lato corriere che non chiamano niente
// (tracking/aggiorna, spedizioni/tracking, v1/tracking) e quelle che nasceranno. Le nove chiamate
// dalle porte d'annullo (elimina, annullamenti-cron, annulli-manuali/conferma, lib/storno-dva,
// lib/annullo-poste, v1/shipments) sono solo un acceleratore: annullaFulfillmentShopify, in fondo.

// Tutti i testi dell'annullo cominciano cosi'. Dicono di chi sono i tentativi che la riga porta: una
// riga che arriva all'annullo col tetto gia' consumato dall'EVASIONE (testo senza prefisso) riparte
// da zero, una che l'ha consumato con l'annullo si ferma.
export const PREFISSO_ANNULLO = 'Annullo su Shopify'

// L'esito 'annullato_store': il negoziante ha annullato l'ordine sul negozio. Gli stessi testi
// dall'evasione, dalla sync e dall'annullo: sono il suggerimento del badge rosso in pagina.
// Due testi, non uno: se l'ordine viaggia in un pacco con altri ordini (ordini uniti), la spedizione porta
// anche la loro merce, e il consiglio di annullarla avrebbe fermato ordini validi e pagati.
const TESTO_ANNULLATO_STORE = "Ordine annullato sul negozio: se c'è una spedizione ancora attiva per quest'ordine, annullala dal portale"
const TESTO_ANNULLATO_STORE_NEL_PACCO = "Ordine annullato sul negozio, ma viaggia in un pacco con altri ordini: prima di annullare la spedizione controlla che non porti merce di ordini ancora validi"
export const testoAnnullatoStore = (nelPacco: boolean): string => nelPacco ? TESTO_ANNULLATO_STORE_NEL_PACCO : TESTO_ANNULLATO_STORE

const QUERY_EVASIONI_ORDINE = `query($id: ID!){ order(id:$id){ cancelledAt displayFulfillmentStatus closed closedAt fulfillments(first:50){ id status trackingInfo{ number url } } } }`

export type SpedizioneNostra = { id: string; stato: string; numero?: string | null; tracking_number?: string | null; annullamento_richiesto_at?: string | null }
export type EvasioniNostre = { perToken: Map<string, SpedizioneNostra[]>; perNumero: Map<string, SpedizioneNostra[]> }
export type ClassificaEvasioni = {
  morte: any[]            // attive, di sole spedizioni nostre annullate: si annullano
  vive: any[]             // attive, di almeno una spedizione nostra non annullata: non si toccano
  estranee: any[]         // attive, senza tracking o con un tracking che non e' nostro: non si toccano MAI
  storia: boolean         // c'e' un'evasione nostra, anche gia' annullata: l'ordine e' passato da noi
  spedizioniVive: SpedizioneNostra[]
  spedizioniAnnullate: SpedizioneNostra[]   // nostre e annullate, da evasioni attive o gia' annullate
}

// Il token della nostra pagina di tracciamento dentro l'url di un'evasione. Dal 09/09/2026 ogni nostra
// fulfillmentCreate porta `${base}/traccia/<token>` (fulfillSpedizioniShopify): regge anche se il
// numero viene cambiato a mano dopo l'invio.
const tokenDaUrl = (url: any): string | null => {
  const m = String(url || '').match(/\/traccia\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}
const chiaveNumero = (n: any): string => String(n || '').replace(/\s+/g, '').toUpperCase()
const numeriEvasione = (f: any): string[] => ((f?.trackingInfo) || []).map((t: any) => String(t?.number || '').trim()).filter(Boolean)

// Le spedizioni DEL CLIENTE che corrispondono alle evasioni dell'ordine, per token della pagina di
// tracciamento e per numero. Una lettura che fallisce LANCIA: prendere le evasioni per estranee
// vorrebbe dire non riconoscere mai le nostre morte e chiudere l'annullo con "niente da annullare".
export async function evasioniNostre(db: any, clienteId: string, evasioni: any[]): Promise<EvasioniNostre> {
  const perToken = new Map<string, SpedizioneNostra[]>()
  const perNumero = new Map<string, SpedizioneNostra[]>()
  const tokens = new Set<string>()
  const numeri = new Set<string>()
  for (const f of evasioni || []) for (const t of (f?.trackingInfo || [])) {
    const tok = tokenDaUrl(t?.url)
    if (tok) tokens.add(tok)
    const n = String(t?.number || '').trim()
    if (n) { numeri.add(n); numeri.add(n.toUpperCase()) }
  }
  if (!clienteId || (!tokens.size && !numeri.size)) return { perToken, perNumero }
  const metti = (m: Map<string, SpedizioneNostra[]>, k: string, s: any) => {
    if (!k) return
    const l = m.get(k) || []
    if (!l.some(x => x.id === String(s.id))) l.push({ id: String(s.id), stato: String(s.stato || ''), numero: s.numero || null, tracking_number: s.tracking_number || null, annullamento_richiesto_at: s.annullamento_richiesto_at || null })
    m.set(k, l)
  }
  if (tokens.size) {
    const { data, error } = await db.from('spedizioni').select('id,stato,numero,tracking_number,tracking_token,annullamento_richiesto_at')
      .eq('cliente_id', clienteId).in('tracking_token', Array.from(tokens))
    if (error) throw new Error('lettura spedizioni per tracciamento: ' + error.message)
    for (const s of data || []) metti(perToken, String(s.tracking_token || ''), s)
  }
  if (numeri.size) {
    const { data, error } = await db.from('spedizioni').select('id,stato,numero,tracking_number,tracking_token,annullamento_richiesto_at')
      .eq('cliente_id', clienteId).in('tracking_number', Array.from(numeri))
    if (error) throw new Error('lettura spedizioni per numero: ' + error.message)
    for (const s of data || []) metti(perNumero, chiaveNumero(s.tracking_number), s)
  }
  return { perToken, perNumero }
}

// SI TOCCA SOLO CIO' CHE E' NOSTRO, E MORTO.
//
// Prima l'annullo prendeva tutti i fulfillment non ancora annullati dell'ordine. Su un ordine spezzato
// — merce in due magazzini, o una parte spedita a mano dal negoziante dall'admin, o da un'app di
// terzi — annullare una nostra spedizione cancellava anche l'evasione degli altri. Non e' un difetto
// estetico: la doc di fulfillmentCancel dice che l'annullo "reverses its effects on associated
// FulfillmentOrder objects... the system creates new fulfillment orders for the cancelled items",
// cioe' si riapre l'evasione di merce gia' partita davvero. E con il tracking vuoto (le DVA
// provvisorie) il filtro di allora lasciava passare TUTTE le evasioni dell'ordine.
//
// Sulle sole evasioni non CANCELLED:
//  - nostra: il token dell'url o il numero corrispondono a una spedizione dello stesso cliente;
//  - morta: TUTTE le corrispondenze sono spedizioni 'annullata'. Solo queste si annullano;
//  - viva: almeno una corrispondenza non e' annullata (anche in attesa d'annullo: si puo' ripristinare);
//  - estranea: nessuna corrispondenza, o nessun tracking. Un'estranea non si tocca mai: nel dubbio no.
// Pura: niente rete, niente database.
export function classificaEvasioni(evasioni: any[], nostre: EvasioniNostre): ClassificaEvasioni {
  const esito: ClassificaEvasioni = { morte: [], vive: [], estranee: [], storia: false, spedizioniVive: [], spedizioniAnnullate: [] }
  for (const f of evasioni || []) {
    const trovate = new Map<string, SpedizioneNostra>()
    for (const t of (f?.trackingInfo || [])) {
      const tok = tokenDaUrl(t?.url)
      if (tok) for (const s of nostre.perToken.get(tok) || []) trovate.set(s.id, s)
      const n = chiaveNumero(t?.number)
      if (n) for (const s of nostre.perNumero.get(n) || []) trovate.set(s.id, s)
    }
    const sped = Array.from(trovate.values())
    if (sped.length) esito.storia = true
    for (const s of sped) if (s.stato === 'annullata' && !esito.spedizioniAnnullate.some(x => x.id === s.id)) esito.spedizioniAnnullate.push(s)
    if (String(f?.status || '').toUpperCase() === 'CANCELLED') continue
    if (!sped.length) esito.estranee.push(f)
    else if (sped.every(s => s.stato === 'annullata')) esito.morte.push(f)
    else { esito.vive.push(f); esito.spedizioniVive.push(...sped.filter(s => s.stato !== 'annullata')) }
  }
  return esito
}

// Quello che serve a statoDaShopify di un ordine letto da Shopify (null = illeggibile).
export type FotoOrdineShopify = { annullato: boolean; evaso: boolean; morteAttive: number }
export function fotoOrdine(ordine: any, cls: ClassificaEvasioni | null): FotoOrdineShopify | null {
  if (!ordine) return null
  return {
    annullato: !!ordine.cancelledAt,
    evaso: String(ordine.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED',
    morteAttive: cls?.morte.length || 0,
  }
}

// COSA DICE SHOPIFY DI UNA RIGA SENZA UNA NOSTRA SPEDIZIONE. Una regola sola per la sync e per
// l'annullo, cosi' le due strade non si smentiscono a vicenda.
//  - ordine annullato: 'annullato' (lo tratta chi chiama);
//  - un'evasione nostra morta ancora attiva: nessun cambio. L'ordine risulta evaso, ma col tracking di
//    una spedizione che abbiamo annullato: chiuderlo 'spedito' lo toglieva da «Da spedire» con il
//    pacco mai partito, ed e' quello che la sync faceva a ogni giro;
//  - FULFILLED: 'spedito', anche dopo un nostro annullo, se l'ha evaso il negoziante a mano;
//  - uscito dagli aperti (archiviato o eliminato) o illeggibile: 'spedito' come sempre, ma solo se
//    l'ordine non e' mai passato da un'evasione nostra (conStoria); altrimenti nessun cambio.
// `conStoria`: la riga ha un esito d'evasione nostro (ok, attesa, errore, annullato) oppure su Shopify
// c'e' un'evasione nostra, anche annullata. `assente`: l'ordine e' uscito dagli aperti, e lo deve dire
// l'ordine stesso (closed), non il fatto che manchi da una lista che puo' essere troncata. Pura.
export function statoDaShopify(foto: FotoOrdineShopify | null, opz: { conStoria: boolean; assente: boolean }): 'annullato' | 'spedito' | null {
  if (foto?.annullato) return 'annullato'
  if (foto && foto.morteAttive > 0) return null
  if (foto?.evaso) return 'spedito'
  if ((!foto || opz.assente) && !opz.conStoria) return 'spedito'
  return null
}

// Annulla su Shopify le evasioni date (le morte di classificaEvasioni). L'esito si guarda: Shopify
// RIFIUTA di annullare un fulfillment gia' consegnato o consolidato, e scrivere 'annullato' lo stesso
// metterebbe nei nostri dati una cosa che sullo store non e' successa. Un errore di rete lancia, e chi
// chiama lo tratta come un rifiuto da ritentare.
export async function annullaEvasioni(shop: string, token: string, morte: any[]): Promise<{ annullate: string[]; rifiuti: { id: string; messaggio: string }[] }> {
  const annullate: string[] = []
  const rifiuti: { id: string; messaggio: string }[] = []
  for (const f of morte || []) {
    const r = await shopifyGraphQL(shop, token,
      `mutation($id: ID!){ fulfillmentCancel(id:$id){ fulfillment{ id status } userErrors{ field message } } }`,
      { id: f.id })
    const errs = (r as any)?.fulfillmentCancel?.userErrors || []
    if (errs.length) rifiuti.push({ id: String(f.id), messaggio: errs.map((e: any) => e.message).join('; ') })
    else annullate.push(String(f.id))
  }
  return { annullate, rifiuti }
}

// I rifiuti che restano tali nell'ordine riletto. Se una porta e il recupero annullano la stessa
// evasione insieme, il secondo riceve un rifiuto per un'evasione che ora risulta CANCELLED: e' andata.
function rifiutiVeri(rifiuti: { id: string; messaggio: string }[], ordine: any): string[] {
  const statoDi = new Map<string, string>(((ordine?.fulfillments) || []).map((f: any) => [String(f.id), String(f.status || '').toUpperCase()]))
  return rifiuti.filter(r => statoDi.get(r.id) !== 'CANCELLED').map(r => r.messaggio)
}

// L'integrazione di una riga: per id oppure, per una riga rimasta orfana di un ricollegamento (a ogni
// ricollega nasce un'integrazione nuova e la vecchia sparisce), quella attiva dello stesso negozio e
// cliente. select('*') come nel resto del file: chi chiama passa il client amministrativo.
export async function integrazioneDellaRiga(db: any, riga: any): Promise<any | null> {
  if (riga?.integrazione_id) {
    const { data, error } = await db.from('integrazioni').select('*').eq('id', riga.integrazione_id).maybeSingle()
    if (error) throw new Error('lettura integrazione: ' + error.message)
    if (data) return data
  }
  if (!riga?.shop || !riga?.cliente_id) return null
  const { data, error } = await db.from('integrazioni').select('*')
    .eq('piattaforma', 'shopify').eq('cliente_id', riga.cliente_id).eq('identificativo', riga.shop).eq('stato', 'attivo')
    .order('id').limit(1)
  if (error) throw new Error('lettura integrazione del negozio: ' + error.message)
  return (data || [])[0] || null
}

const COLONNE_RIGA_ANNULLO = 'id,cliente_id,integrazione_id,shop,piattaforma,ordine_esterno_id,numero_ordine,stato,spedizione_id,unito_in,fulfillment_stato,fulfillment_errore,fulfillment_tentativi,created_at'

// Una riga Shopify evasa e poi staccata dalla sua spedizione.
const conLaTraccia = (r: any) => r?.piattaforma === 'shopify' && !r.spedizione_id && ESITI_EVASIONE.includes(String(r.fulfillment_stato || ''))
// Il tetto vale per i tentativi dell'ANNULLO. La prima volta che l'annullo prende una riga, i tentativi
// che porta sono quelli dell'evasione (una riga puo' essere arrivata al tetto mentre il negozio non
// rispondeva): non contano.
const ammessaAllAnnullo = (r: any) =>
  !String(r?.fulfillment_errore || '').startsWith(PREFISSO_ANNULLO) || Number(r?.fulfillment_tentativi || 0) < MAX_TENTATIVI_NEGOZIO
// Lo stesso ordine puo' stare su piu' righe, una per ogni ricollegamento del negozio: si lavora una
// volta per ordine. Le righe di prima del 09/09 non hanno `shop`: restano legate alla loro integrazione.
const chiaveOrdine = (r: any) => `${r.cliente_id}|${r.shop || 'integrazione:' + r.integrazione_id}|${r.ordine_esterno_id}`

export type OrdineDaRiconciliare = { chiave: string; righe: any[] }

// Le righe Shopify con la traccia, unite o no, a pagine da 1000.
async function righeConLaTraccia(db: any, unite: boolean, clienti?: string[]): Promise<any[]> {
  const righe: any[] = []
  for (let da = 0; ; da += 1000) {
    let q = db.from('ordini_ecommerce').select(COLONNE_RIGA_ANNULLO)
      .eq('piattaforma', 'shopify').is('spedizione_id', null).in('fulfillment_stato', ESITI_EVASIONE)
    q = unite ? q.not('unito_in', 'is', null) : q.is('unito_in', null)
    if (clienti?.length) q = q.in('cliente_id', clienti)
    const { data, error } = await q.order('created_at', { ascending: false }).order('id').range(da, da + 999)
    if (error) throw new Error('lettura righe da riconciliare: ' + error.message)
    righe.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  return righe
}

// GLI ORDINI DA RICONCILIARE, uno per ordine.
//  - Righe Shopify con la traccia del trigger, non unite.
//  - Righe UNITE con la traccia, cercate per conto loro e non piu' solo come figlie di un capofila
//    candidato nello stesso giro: cosi' un assorbito restava fuori per sempre appena il capofila aveva il
//    suo esito finale (anche se il suo annullo era da ritentare, o se la scadenza del giro l'aveva
//    tagliato), e non entrava mai se il capofila non aveva la traccia (un capofila 'annullato_store' col
//    pacco partito con la merce degli altri). Entrano solo se NON stanno in un pacco vivo: il loro pacco non
//    c'e' piu' (la spedizione del capofila si e' annullata e il trigger l'ha staccato) o non e' mai partito,
//    oppure la riga non e' piu' 'unito' (era partita con una spedizione sua, poi annullata). Un assorbito
//    di un pacco in viaggio ha la stessa firma (nessuna spedizione sua, esito 'ok') ma un'evasione viva:
//    preso da qui finirebbe in 'errore' e riempirebbe i posti degli annulli veri.
//  - Ammesse se non portano gia' un testo d'annullo oppure se hanno meno tentativi del tetto.
//  - Prima le unite, poi le altre, ognuna dalla piu' recente; il limite vale DOPO i filtri, sugli ordini.
// Con `righe` si lavorano quelle (gia' trovate da una porta) e gli assorbiti dei loro ordini, con gli
// stessi filtri.
export async function candidatiRiconciliazione(db: any, opz: { righe?: any[]; clienti?: string[]; limite?: number } = {}): Promise<OrdineDaRiconciliare[]> {
  const base = opz.righe ? opz.righe : await righeConLaTraccia(db, false, opz.clienti)
  const ammesse = base.filter((r: any) => conLaTraccia(r) && !r.unito_in && ammessaAllAnnullo(r))

  let unite: any[]
  if (opz.righe) {
    const perId = new Map<string, any>(opz.righe.filter((r: any) => r?.unito_in).map((r: any) => [String(r.id), r]))
    if (ammesse.length) {
      const perCapo = await assorbitiDi(db, ammesse.map((r: any) => String(r.id)), COLONNE_RIGA_ANNULLO)
      for (const loro of perCapo.values()) for (const a of loro) perId.set(String(a.id), a)
    }
    unite = Array.from(perId.values())
  } else unite = await righeConLaTraccia(db, true, opz.clienti)
  unite = unite.filter((r: any) => conLaTraccia(r) && r.unito_in && ammessaAllAnnullo(r))
  const daGuardare = unite.filter((r: any) => r.stato === 'unito')
  const pacco = daGuardare.length ? await spedizioneDelPacco(db, daGuardare) : new Map<string, string | null>()
  unite = unite.filter((r: any) => r.stato !== 'unito' || !pacco.get(String(r.id)))

  const piuRecenti = (a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || ''))
  const perOrdine = new Map<string, any[]>()
  for (const r of [...unite.sort(piuRecenti), ...ammesse.sort(piuRecenti)]) {
    const k = chiaveOrdine(r)
    if (!perOrdine.has(k)) perOrdine.set(k, [])
    perOrdine.get(k)!.push(r)
  }
  let ordini: OrdineDaRiconciliare[] = Array.from(perOrdine, ([chiave, righe]) => ({ chiave, righe }))
  if (opz.limite && opz.limite > 0) ordini = ordini.slice(0, opz.limite)
  return ordini
}

// LA VIA VELOCE DELLE PORTE: le righe degli ordini delle spedizioni appena annullate. La spedizione
// porta il numero d'ordine com'era scritto sul negozio (rif_ordine, col cancelletto o, prima, senza);
// la riga e' dello stesso cliente, senza spedizione, non unita, con un esito d'evasione. Solo
// spedizioni ancora 'annullata': una ripristinata nel frattempo non si tocca.
export async function righeDelleSpedizioniAnnullate(db: any, spedizioneIds: string[]): Promise<any[]> {
  const ids = Array.from(new Set((spedizioneIds || []).filter(Boolean).map(String)))
  if (!ids.length) return []
  const formePerCliente = new Map<string, Set<string>>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('spedizioni').select('id,cliente_id,rif_ordine')
      .in('id', ids.slice(i, i + 200)).eq('stato', 'annullata')
    if (error) throw new Error('lettura spedizioni annullate: ' + error.message)
    for (const s of data || []) {
      const n = String(s.rif_ordine || '').trim()
      if (!s.cliente_id || !n) continue
      const nudo = n.replace(/^#/, '')
      const forme = formePerCliente.get(String(s.cliente_id)) || new Set<string>()
      forme.add(n); forme.add(nudo); forme.add('#' + nudo)
      formePerCliente.set(String(s.cliente_id), forme)
    }
  }
  const righe: any[] = []
  for (const [clienteId, forme] of formePerCliente) {
    const { data, error } = await db.from('ordini_ecommerce').select(COLONNE_RIGA_ANNULLO)
      .eq('piattaforma', 'shopify').eq('cliente_id', clienteId).in('numero_ordine', Array.from(forme))
      .is('spedizione_id', null).is('unito_in', null).in('fulfillment_stato', ESITI_EVASIONE)
    if (error) throw new Error('lettura ordini delle spedizioni annullate: ' + error.message)
    righe.push(...(data || []))
  }
  return righe
}

// IL PACCO POSTE ANNULLATO RESTA SOTTO CONTROLLO. Una SDA EXPRESS L, e ogni pacco con la LDV vera su un
// contratto Poste diretto, non si annulla presso il corriere: l'annullo si chiude sul portale e per 30
// giorni si guarda se il pacco parte lo stesso; se parte, si riaddebita (lib/annullo-poste). L'evasione
// su Shopify si toglie comunque, ma la riga torna «Da spedire» mentre il pacco vecchio puo' ancora
// partire, e il riaddebito non la ricollega (domanda 5a del piano del 20/10/2026, ancora aperta):
// rispedita da li', sarebbero due pacchi e due addebiti senza che niente sulla riga lo dicesse. Torna la
// spedizione la cui sorveglianza finisce piu' tardi, oppure null. Solo letture. Il riconoscimento del
// pacco Poste e' quello della sorveglianza (gambePaccoPoste): se la lettura delle gambe non riesce, il
// pacco non risulta Poste e l'avviso manca.
async function pacchiPosteInSorveglianza(db: any, spedizioni: SpedizioneNostra[]): Promise<{ numero: string; fino: Date } | null> {
  const conData = (spedizioni || []).filter(s => s.stato === 'annullata' && s.annullamento_richiesto_at)
  if (!conData.length) return null
  const { gambePaccoPoste, GIORNI_SORVEGLIANZA } = await import('@/lib/annullo-poste')
  let scelta: { numero: string; fino: Date } | null = null
  for (const s of conData) {
    const fino = new Date(new Date(String(s.annullamento_richiesto_at)).getTime() + GIORNI_SORVEGLIANZA * 86400000)
    if (isNaN(fino.getTime()) || fino.getTime() <= Date.now()) continue
    if (!(await gambePaccoPoste(db, s.tracking_number))) continue
    if (!scelta || fino > scelta.fino) scelta = { numero: String(s.numero || s.tracking_number || ''), fino }
  }
  return scelta
}
const dataBreve = (d: Date) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })
const testoSorveglianza = (s: { numero: string; fino: Date }) =>
  `evasione tolta, ma la spedizione ${s.numero} è sotto controllo fino al ${dataBreve(s.fino)}: se il pacco parte viene riaddebitata. Prima di rispedire, verifica che non sia partito`

type EsitoAnnullo = {
  fulfillment_stato: string
  testo: string
  definitivo: boolean            // non si ritenta: vale il tetto dei tentativi
  stato?: 'spedito' | 'da_spedire'
  annullate: number
  piano: any
}

// L'esito di un ordine. Ogni ramo lo toglie dai candidati oppure lo fa ritentare:
//  a. tolta almeno un'evasione nostra morta, nessun rifiuto: 'annullato'; lo stato lo dice Shopify
//     riletto ('spedito' se resta evaso da altri, altrimenti 'da_spedire');
//  b. nessuna evasione nostra attiva (mai creata, o gia' annullata da noi o dal negoziante):
//     'annullato', stato come in a. Finale;
//  c. un'evasione nostra di una spedizione che NON e' piu' annullata (riaddebito SDA EXPRESS L) e
//     nessuna morta: non si tocca; 'errore' definitivo, stato 'spedito'. Ricollegare l'ordine lo
//     decide Lorenzo (domanda 5b del piano);
//  d. ordine annullato su Shopify: 'annullato_store', lo stato lo decide la sync. Finale;
//  e. ordine illeggibile (oltre 60 giorni, o eliminato): 'errore' definitivo. Prima diventava
//     'annullato' con "fulfillment annullato su Shopify" senza aver annullato niente;
//  f. negozio non piu' collegato: 'errore' definitivo;
//  g. rifiuto, token mancante, eccezione: 'errore', da ritentare. Prima un rifiuto lasciava 'ok'
//     (nessun badge), e token o integrazione mancanti un `continue` muto;
//  h. come a o b, ma la spedizione annullata e' un pacco Poste ancora sotto controllo: 'errore'
//     definitivo con l'avviso del badge, stato come in a (pacchiPosteInSorveglianza).
// `simula`: nessuna mutation e nessun rinnovo del token; dice cosa farebbe.
async function esitoAnnulloOrdine(db: any, o: OrdineDaRiconciliare, simula: boolean): Promise<EsitoAnnullo> {
  const riga = o.righe[0]
  const piano: any = { ordine: riga.numero_ordine, negozio: riga.shop || null, righe: o.righe.length }
  const esito = (fulfillment_stato: string, testo: string, altro: Partial<EsitoAnnullo> = {}): EsitoAnnullo => {
    piano.esito = `${fulfillment_stato}: ${testo}`
    return { fulfillment_stato, testo, definitivo: false, annullate: 0, piano, ...altro }
  }
  const definitivo = (testo: string, altro: Partial<EsitoAnnullo> = {}) => esito('errore', `${PREFISSO_ANNULLO}: ${testo}`, { ...altro, definitivo: true })
  const daRitentare = (motivo: string, altro: Partial<EsitoAnnullo> = {}) => esito('errore', `${PREFISSO_ANNULLO} non riuscito: ${motivo}`, altro)
  try {
    let integr: any = null
    for (const r of o.righe) { integr = await integrazioneDellaRiga(db, r); if (integr) break }
    const shop = (integr?.credenziali as any)?.shop
    if (!integr || !shop) return definitivo("il negozio non è più collegato: se l'evasione col tracking annullato è ancora attiva, annullala dall'admin di Shopify")
    let token: string
    if (simula) {
      const t = tokenValidoSenzaRinnovo(integr)
      if (!t) return daRitentare('token da rinnovare (la simulazione non lo rinnova): riprova dopo un giro del cron')
      token = t
    } else {
      const tk = await getValidShopifyToken(integr, db)
      if (tk.error || !tk.token) return daRitentare(tk.error || 'token non disponibile')
      token = tk.token
    }
    const gid = `gid://shopify/Order/${riga.ordine_esterno_id}`
    const leggi = async () => ((await shopifyGraphQL(shop, token, QUERY_EVASIONI_ORDINE, { id: gid })) as any)?.order || null
    let ord = await leggi()
    if (!ord) return definitivo("Shopify non rende più leggibile l'ordine (oltre 60 giorni o eliminato): se l'evasione col tracking annullato è ancora attiva, annullala dall'admin di Shopify")
    piano.closed = ord.closed ?? null
    piano.closedAt = ord.closedAt ?? null
    if (ord.cancelledAt) return esito('annullato_store', testoAnnullatoStore(!!riga.unito_in))

    const nostre = await evasioniNostre(db, riga.cliente_id, ord.fulfillments || [])
    const cls = classificaEvasioni(ord.fulfillments || [], nostre)
    piano.morte = cls.morte.map(numeriEvasione)
    piano.vive = cls.vive.map(numeriEvasione)
    piano.estranee = cls.estranee.length
    // h: un pacco Poste annullato e ancora sotto controllo. Vale per a e per b, non per c (li' la
    // spedizione e' di nuovo attiva). Conta anche le evasioni nostre gia' annullate: un giro che ha tolto
    // l'evasione senza riuscire a scrivere l'esito ritrova l'avviso al giro dopo, in b.
    const sorveglianza = cls.vive.length && !cls.morte.length ? null : await pacchiPosteInSorveglianza(db, cls.spedizioniAnnullate)
    if (sorveglianza) piano.sorveglianza = `${sorveglianza.numero} fino al ${dataBreve(sorveglianza.fino)}`
    if (cls.morte.length) {
      const numeri = Array.from(new Set(cls.morte.flatMap(numeriEvasione))).join(', ') || 'senza numero'
      if (simula) return esito('annullato', `${PREFISSO_ANNULLO}: toglierebbe l'evasione col tracking ${numeri} della spedizione annullata`)
      const { rifiuti } = await annullaEvasioni(shop, token, cls.morte)
      ord = await leggi()
      const ancora = rifiutiVeri(rifiuti, ord)
      const annullate = cls.morte.length - ancora.length
      if (ancora.length) return daRitentare(ancora.join(' | '), { annullate })
      const st = statoDaShopify(fotoOrdine(ord, ord ? classificaEvasioni(ord.fulfillments || [], nostre) : null), { conStoria: true, assente: false })
      const stato = st === 'spedito' ? 'spedito' : 'da_spedire'
      if (sorveglianza) return definitivo(testoSorveglianza(sorveglianza), { annullate, stato })
      return esito('annullato', `${PREFISSO_ANNULLO}: tolta l'evasione col tracking ${numeri} della spedizione annullata`, { annullate, stato })
    }
    if (cls.vive.length) {
      const quali = Array.from(new Set(cls.spedizioniVive.map(s => s.numero || s.tracking_number).filter(Boolean))).join(', ')
      return definitivo(`la spedizione ${quali || 'collegata'} è di nuovo attiva: evasione lasciata, l'ordine va ricollegato`, { stato: 'spedito' })
    }
    const st = statoDaShopify(fotoOrdine(ord, cls), { conStoria: true, assente: false })
    const stato = st === 'spedito' ? 'spedito' : 'da_spedire'
    if (sorveglianza) return definitivo(testoSorveglianza(sorveglianza), { stato })
    return esito('annullato', `${PREFISSO_ANNULLO}: nessuna evasione nostra attiva da annullare`, { stato })
  } catch (e: any) {
    return daRitentare(String(e?.message || e))
  }
}

// Scrive l'esito di un ordine.
async function scriviEsitoAnnullo(db: any, o: OrdineDaRiconciliare, e: EsitoAnnullo, contaTentativi: boolean) {
  const riga = o.righe[0]
  // TENTATIVI. Li conta solo il recupero, una volta per giro: il cron degli annulli chiama le porte
  // fino a 200 volte di fila, e un disservizio di pochi minuti di Shopify brucerebbe il tetto in un
  // giro solo. Si riparte da zero se la riga non portava ancora un testo d'annullo; un esito definitivo
  // vale il tetto.
  const giaAnnullo = o.righe.filter((r: any) => String(r.fulfillment_errore || '').startsWith(PREFISSO_ANNULLO))
  const base = giaAnnullo.length ? Math.max(...giaAnnullo.map((r: any) => Number(r.fulfillment_tentativi || 0))) : 0
  const contati = base + (contaTentativi ? 1 : 0)
  const tentativi = e.definitivo ? MAX_TENTATIVI_NEGOZIO : e.fulfillment_stato === 'errore' ? contati : base
  const testo = e.testo.slice(0, 200)
  const esitoRiga = { fulfillment_stato: e.fulfillment_stato, fulfillment_errore: testo, fulfillment_tentativi: tentativi }
  // L'ESITO VA SU TUTTE LE RIGHE SENZA SPEDIZIONE DELLO STESSO ORDINE. Una riga orfana di un
  // ricollegamento non compare in lista (app/api/ordini/lista mostra le sole integrazioni esistenti),
  // la sua gemella si': scritto solo sull'orfana, il negoziante non vedrebbe niente.
  const dellOrdine = (q: any) => {
    q = q.eq('piattaforma', 'shopify').eq('cliente_id', riga.cliente_id).eq('ordine_esterno_id', riga.ordine_esterno_id).is('spedizione_id', null)
    return riga.shop ? q.eq('shop', riga.shop) : q.eq('integrazione_id', riga.integrazione_id)
  }
  // Una scrittura che non passa (un vincolo sui valori di fulfillment_stato? il database che non
  // risponde?): si scrivono almeno i tentativi col testo dell'annullo, e l'esito d'evasione resta quello
  // di prima. Cosi' la riga resta candidata e si ferma al tetto, invece di girare per sempre o di uscire
  // dai candidati a lavoro fatto a meta'.
  const ripiego = async (motivo: string) => {
    console.error('[SHOPIFY][ANNULLO EVASIONE] esito non scritto:', o.chiave, e.fulfillment_stato, motivo)
    const conPrefisso = testo.startsWith(PREFISSO_ANNULLO) ? testo : `${PREFISSO_ANNULLO}: ${testo}`.slice(0, 200)
    const { error: e2 } = await dellOrdine(db.from('ordini_ecommerce').update({ fulfillment_errore: conPrefisso, fulfillment_tentativi: contati }))
    if (e2) console.error('[SHOPIFY][ANNULLO EVASIONE] tentativi non scritti:', o.chiave, e2.message)
  }

  // PRIMA le righe che cambiano stato, con ESITO E STATO NELLA STESSA SCRITTURA. Scrivendo prima l'esito
  // su tutte e lo stato dopo, un errore in mezzo lasciava l'ordine fuori dai candidati ('annullato' e'
  // finale) con lo stato di prima per sempre: per esempio 'spedito' su un ordine che su Shopify e' tornato
  // da evadere, che cosi' non ricompariva piu' in «Da spedire». Ora un errore qui non ha cambiato niente,
  // e il giro dopo riprova.
  // LO STATO solo sulle righe di integrazioni che esistono ancora, le sole visibili in lista: sulle
  // orfane cambiarlo non mostrerebbe niente, e le toglierebbe alla cancellazione dei dati personali
  // (app/api/privacy/purge-pii). Le guardie stanno nella scrittura: mai una riga con la spedizione, e
  // lo stato cambia solo fra 'da_spedire' e 'spedito', mai da 'unito' ne' da 'annullato'.
  if (e.stato) {
    const { data: righe, error: eR } = await dellOrdine(db.from('ordini_ecommerce').select('id,integrazione_id,stato'))
    if (eR) throw new Error("lettura righe dell'ordine: " + eR.message)
    const integrIds = Array.from(new Set((righe || []).map((r: any) => r.integrazione_id).filter(Boolean).map(String)))
    if (integrIds.length) {
      const { data: esistenti, error: eI } = await db.from('integrazioni').select('id').in('id', integrIds)
      if (eI) throw new Error('lettura integrazioni: ' + eI.message)
      const visibili = new Set((esistenti || []).map((i: any) => String(i.id)))
      const daCambiare = (righe || [])
        .filter((r: any) => visibili.has(String(r.integrazione_id)) && r.stato !== e.stato && ['da_spedire', 'spedito'].includes(String(r.stato)))
        .map((r: any) => r.id)
      if (daCambiare.length) {
        const { error: eS } = await db.from('ordini_ecommerce').update({ ...esitoRiga, stato: e.stato })
          .in('id', daCambiare).is('spedizione_id', null).in('stato', ['da_spedire', 'spedito'])
        if (eS) { await ripiego(eS.message); return }
      }
    }
  }
  // POI l'esito su tutte le righe dell'ordine (su quelle appena scritte non cambia niente).
  const { error } = await dellOrdine(db.from('ordini_ecommerce').update(esitoRiga))
  if (error) await ripiego(error.message)
}

// Gli ordini in lavorazione in questa istanza. I rami DVA chiamano l'annullo due volte per la stessa
// spedizione (lib/storno-dva e poi la porta), e una porta puo' incrociarsi col recupero: un ordine
// gia' in mano a un giro non si riprende in parallelo.
const ordiniInLavorazione = new Set<string>()

export type EsitoRiconciliazione = { candidati: number; ordini: number; annullate: number; errori: number; definitivi: number; piano?: any[] }

// RICONCILIA LE EVASIONI DELLE SPEDIZIONI ANNULLATE: per ogni ordine candidato si legge l'ordine su
// Shopify, si annullano le sole evasioni nostre morte e si scrive l'esito (vedi esitoAnnulloOrdine).
//  - righe: le righe gia' trovate da una porta; vuoto = nessun lavoro, mai «allora tutte»;
//  - clienti: solo questi clienti (collaudo sul cliente demo);
//  - limite: quanti ordini al massimo; scadenza: dopo quest'istante non se ne comincia un altro;
//  - contaTentativi: solo il recupero; simula: nessuna scrittura, nessuna mutation, nessun rinnovo del
//    token, e torna il piano ordine per ordine.
export async function riconciliaEvasioniAnnullate(db: any, opz: { righe?: any[]; clienti?: string[]; limite?: number; scadenza?: number; simula?: boolean; contaTentativi?: boolean } = {}): Promise<EsitoRiconciliazione> {
  const esito: EsitoRiconciliazione = { candidati: 0, ordini: 0, annullate: 0, errori: 0, definitivi: 0 }
  if (opz.simula) esito.piano = []
  if (opz.righe && !opz.righe.length) return esito
  const ordini = await candidatiRiconciliazione(db, opz)
  esito.candidati = ordini.reduce((n, o) => n + o.righe.length, 0)
  for (const o of ordini) {
    if (opz.scadenza && Date.now() > opz.scadenza) break
    if (ordiniInLavorazione.has(o.chiave)) continue
    ordiniInLavorazione.add(o.chiave)
    try {
      const e = await esitoAnnulloOrdine(db, o, !!opz.simula)
      esito.ordini++
      esito.annullate += e.annullate
      if (e.definitivo) esito.definitivi++
      else if (e.fulfillment_stato === 'errore') esito.errori++
      if (opz.simula) esito.piano!.push(e.piano)
      else await scriviEsitoAnnullo(db, o, e, !!opz.contaTentativi)
    } catch (err: any) {
      // Arriva qui solo una lettura fallita in scriviEsitoAnnullo, prima di ogni scrittura (gli errori
      // dell'esito li cattura esitoAnnulloOrdine, quelli delle scritture il ripiego): la riga resta
      // candidata e il recupero la riprende.
      esito.errori++
      console.error('[SHOPIFY][ANNULLO EVASIONE]', o.chiave, String(err?.message || err).slice(0, 200))
    } finally {
      ordiniInLavorazione.delete(o.chiave)
    }
  }
  return esito
}

// L'ACCELERATORE DELLE PORTE D'ANNULLO. Firma di sempre: le nove chiamate non cambiano.
//
// Pianifica il lavoro dopo la risposta e ritorna SUBITO, senza letture ne' chiamate di rete. In due
// porte la chiamata sta fra la scrittura di 'annullata' e lo storno del credito (annullamenti-cron e
// annulli-manuali/conferma): una chiamata a Shopify appesa li' (shopifyGraphQL non ha un timeout)
// farebbe scadere la funzione prima dello storno, e al giro dopo la spedizione, gia' 'annullata', non
// verrebbe piu' rimborsata. Per chi tocca quelle porte: se questo lavoro tornasse sincrono, va messo
// DOPO rimborsaAnnulloSpedizione.
//
// Lavora solo le righe degli ordini delle spedizioni appena annullate, e i tentativi non li conta.
// Fuori da una richiesta (uno script) after() lancia: qui allora non si fa niente, e ci pensa il
// recupero entro 20 minuti. after() dura quanto la rotta: se la rotta finisce prima, le righe restano
// candidate per il recupero.
export async function annullaFulfillmentShopify(db: any, spedizioneIds: string[]) {
  const ids = Array.from(new Set((spedizioneIds || []).filter(Boolean).map(String)))
  if (!ids.length) return
  try {
    const { after } = await import('next/server')
    after(async () => {
      try {
        const righe = await righeDelleSpedizioniAnnullate(db, ids)
        if (righe.length) await riconciliaEvasioniAnnullate(db, { righe, contaTentativi: false })
      } catch (e: any) {
        console.error('[SHOPIFY][ANNULLO EVASIONE] porta:', ids.join(','), String(e?.message || e).slice(0, 200))
      }
    })
  } catch {
    // Nessuna richiesta in corso: lo riprende fulfill-retry.
  }
}
