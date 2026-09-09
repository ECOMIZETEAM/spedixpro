import { createServerSupabase } from '@/lib/supabase'

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

// Restituisce un access token Shopify valido per l'integrazione data.
// Se il token e' scaduto (o sta per scadere), lo rifresca col refresh token
// e aggiorna le credenziali salvate. Ritorna { token } oppure { error }.
export async function getValidShopifyToken(integrazione: any, db?: any): Promise<{ token?: string; error?: string }> {
  const cred = (integrazione?.credenziali || {}) as any
  const shop = cred.shop || integrazione?.identificativo
  const token = cred.access_token
  const refreshToken = cred.refresh_token
  const expiresAt = cred.expires_at ? Number(cred.expires_at) : null

  if (!shop) return { error: 'Credenziali Shopify mancanti' }
  const now = Date.now()

  // ── TOKEN OAUTH: è QUESTO il token buono ────────────────────────────────────
  // È quello che il negoziante ha autorizzato con i permessi che ha concesso (ordini compresi).
  // Va usato per primo, sempre. Il token coniato con client_credentials è un ripiego temporaneo
  // (24h) e NON porta con sé l'autorizzazione del negoziante: usandolo al posto di questo si
  // finisce per chiedere gli ordini senza averne il diritto, e Shopify risponde 403.
  // Si usa il token SOLO se ha una scadenza ancora valida. Un token NON-SCADENTE (expiresAt null,
  // il vecchio tipo) Shopify ora lo RIFIUTA con 403 ("Non-expiring access tokens are no longer
  // accepted"): va rinnovato col refresh (sotto). Prima qui `!expiresAt` lo restituiva com'era —
  // ed era la causa del 403 sulle integrazioni collegate col vecchio flusso.
  if (token && expiresAt && expiresAt - now > 5 * 60 * 1000) {
    return { token }
  }

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
  const { data: ordini } = await supabase
    .from('ordini_ecommerce').select('*')
    .in('spedizione_id', spedizioneIds)
    .eq('piattaforma', 'shopify')
  for (const ordine of ordini || []) {
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
        .eq('id', ordine.spedizione_id).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      // Lo stato si rilegge QUI, non solo all'ingresso: fra la chiamata e questo punto la spedizione
      // puo' essere stata annullata (la spinta gira in after(), dopo la risposta). Evaderla adesso
      // vorrebbe dire mandare al compratore l'email di spedizione con un tracking gia' morto.
      if (['annullata', 'annullamento_pending', 'annullamento_manuale'].includes(String((sped as any)?.stato || ''))) continue
      const company = (sped as any)?.corrieri?.nome_contratto || 'Altro'
      const { data: integr } = await supabase
        .from('integrazioni').select('*').eq('id', ordine.integrazione_id).maybeSingle()
      const shop = (integr?.credenziali as any)?.shop
      if (!integr || !shop) { await segna('errore', 'integrazione non trovata'); continue }
      // Si passa il client GIA' pronto (nel cron e' l'admin/service_role): senza, getValidShopifyToken
      // ripiega su createServerSupabase (user-scoped) e nel cron — che non ha sessione — la RLS blocca
      // il salvataggio del token rinnovato. Shopify invalida il vecchio refresh_token appena lo usi:
      // se il nuovo non si salva, al giro dopo il refresh fallisce e il negozio "si scollega" da solo.
      const tk = await getValidShopifyToken(integr, supabase)
      if (tk.error || !tk.token) { await segna('errore', tk.error || 'token non disponibile'); continue }
      // 1) fulfillment orders dell'ordine (GraphQL)
      //
      // `first: 50`, non 10: oltre il decimo la lista si troncava e i fulfillment order rimasti
      // fuori sembravano non esistere.
      //
      // Si chiedono anche `supportedActions`, `assignedLocation` e `cancelledAt` perche' senza quei
      // tre campi si prendevano tre decisioni al buio (vedi sotto, nell'ordine): se l'ordine esiste
      // ancora, chi deve evadere il fulfillment order, e quante mutation servono.
      const gid = `gid://shopify/Order/${ordine.ordine_esterno_id}`
      const dFo = await shopifyGraphQL(shop, tk.token,
        `query($id: ID!){ order(id:$id){ cancelledAt displayFulfillmentStatus fulfillmentOrders(first:50){ edges{ node{ id status supportedActions{ action } assignedLocation{ name address1 zip } } } } } }`,
        { id: gid })
      const ord = (dFo as any)?.order
      const stato = String(ord?.displayFulfillmentStatus || '')
      const tutti = ((ord?.fulfillmentOrders?.edges) || []).map((e: any) => e.node)
      const azioni = (f: any) => ((f?.supportedActions) || []).map((x: any) => String(x?.action || ''))

      // ORDINE ANNULLATO SULLO STORE: non e' un guasto nostro, e non si sistemera' mai.
      // Prima finiva in 'errore' con "nessun fulfillment order da evadere": badge arancione "Store
      // non aggiornato" acceso per sempre su un ordine che il negoziante ha annullato lui, e otto
      // giri di recupero sprecati su un caso definitivo.
      if (ord?.cancelledAt || stato === 'RESTOCKED') {
        await segna('annullato_store', null)
        continue
      }

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

// ANNULLO DEL FULFILLMENT SU SHOPIFY.
//
// Quando una spedizione viene annullata da noi, l'ordine su Shopify restava "Fulfilled" con un
// numero di tracking che non esiste piu': il merchant vede spedito, il compratore clicca un link
// morto. E' un caso di 2.1.4 ("ensuring that all synchronized data is consistent across the Shopify
// admin, your app, and any additional platforms") preso al contrario rispetto a quello contestato:
// non un'evasione che non arriva, ma un'evasione che resta quando non dovrebbe.
//
// Sta in un posto solo perche' le spedizioni si annullano da QUATTRO punti diversi (elimina x2,
// conferma manuale, cron degli annullamenti): una regola ripetuta quattro volte e' una regola che
// prima o poi in uno dei quattro si dimentica.
//
// Best-effort: se l'annullo su Shopify non riesce, la spedizione resta annullata da noi lo stesso —
// lo stato dell'ordine sullo store si sistema a mano, ma non si blocca l'annullo di una spedizione
// vera per un problema dello store.
export async function annullaFulfillmentShopify(supabase: any, spedizioneIds: string[]) {
  if (!spedizioneIds?.length) return
  // NIENTE filtro su fulfillment_stato='ok'.
  //
  // Sembrava prudente ("annulliamo solo cio' che avevamo evaso") ed era invece il modo di lasciare
  // l'ordine Fulfilled per sempre: da quando la spinta parte subito in after(), chi annulla pochi
  // secondi dopo aver spedito arriva qui mentre lo stato e' ancora null — nessuna riga, nessun
  // annullo, e su Shopify resta un'evasione con un tracking morto. Cosa annullare lo decide adesso
  // Shopify, confrontando i tracking (sotto): se non c'e' niente di nostro da annullare, non si
  // annulla niente.
  const { data: ordini } = await supabase
    .from('ordini_ecommerce').select('*')
    .in('spedizione_id', spedizioneIds)
    .eq('piattaforma', 'shopify')
  // Il tracking delle spedizioni che stiamo annullando: e' il discriminante fra "il nostro
  // fulfillment" e quello di qualcun altro.
  const { data: spedAnn } = await supabase
    .from('spedizioni').select('id,tracking_number').in('id', spedizioneIds)
  const trackingDi = new Map<string, string>((spedAnn || []).map((x: any) => [String(x.id), String(x.tracking_number || '')]))
  const soloCifre = (t: string) => String(t || '').replace(/[^0-9a-z]/gi, '').toLowerCase()
  for (const ordine of ordini || []) {
    try {
      const { data: integr } = await supabase
        .from('integrazioni').select('*').eq('id', ordine.integrazione_id).maybeSingle()
      const shop = (integr?.credenziali as any)?.shop
      if (!integr || !shop) continue
      const tk = await getValidShopifyToken(integr, supabase)
      if (tk.error || !tk.token) continue

      // SI ANNULLA SOLO IL NOSTRO FULFILLMENT, riconosciuto dal numero di tracking.
      //
      // Prima si prendevano TUTTI i fulfillment non ancora annullati dell'ordine. Su un ordine
      // spezzato — merce in due magazzini, o una parte spedita a mano dal negoziante dall'admin, o
      // da un'app di terzi — annullare una nostra spedizione cancellava anche l'evasione degli
      // altri. Non e' un difetto estetico: la doc di fulfillmentCancel dice che l'annullo "reverses
      // its effects on associated FulfillmentOrder objects... the system creates new fulfillment
      // orders for the cancelled items", cioe' si riapre l'evasione di merce gia' partita davvero e
      // si tocca il magazzino di un negozio che non c'entra niente.
      const nostro = soloCifre(trackingDi.get(ordine.spedizione_id) || '')
      const gid = `gid://shopify/Order/${ordine.ordine_esterno_id}`
      const d = await shopifyGraphQL(shop, tk.token,
        `query($id: ID!){ order(id:$id){ fulfillments(first:20){ id status trackingInfo{ number } } } }`, { id: gid })
      const daAnnullare = ((d?.order?.fulfillments) || [])
        .filter((f: any) => f.status !== 'CANCELLED')
        .filter((f: any) => !nostro || ((f?.trackingInfo) || []).some((t: any) => soloCifre(t?.number) === nostro))
      const rifiuti: string[] = []
      for (const f of daAnnullare) {
        const r = await shopifyGraphQL(shop, tk.token,
          `mutation($id: ID!){ fulfillmentCancel(id:$id){ fulfillment{ id status } userErrors{ field message } } }`,
          { id: f.id })
        // L'esito si guarda: Shopify RIFIUTA di annullare un fulfillment gia' consegnato o
        // consolidato. Marcarlo 'annullato' lo stesso avrebbe scritto nei nostri dati una cosa
        // che sullo store non e' successa.
        const errs = (r as any)?.fulfillmentCancel?.userErrors || []
        if (errs.length) rifiuti.push(errs.map((e: any) => e.message).join('; '))
      }

      if (rifiuti.length) {
        await supabase.from('ordini_ecommerce')
          .update({ fulfillment_errore: ('Shopify non ha annullato il fulfillment: ' + rifiuti.join(' | ')).slice(0, 200) })
          .eq('id', ordine.id)
        continue
      }

      // SI SCOLLEGA L'ORDINE DALLA SPEDIZIONE ANNULLATA. Senza questo, la correzione si disfaceva
      // da sola entro venti minuti: il cron di recupero pesca tutto cio' che non e' 'ok'
      // (fulfill-retry: `fulfillment_stato.neq.ok`) e richiede solo che spedizione_id ci sia. Con
      // 'annullato' e il link ancora al suo posto, rievadeva la spedizione appena annullata e
      // mandava al compratore una SECONDA email di spedizione, con un tracking che non esiste piu'.
      // Sganciando il link l'ordine torna anche spedibile: e' quello che serve dopo un annullo.
      await supabase.from('ordini_ecommerce')
        .update({
          fulfillment_stato: 'annullato',
          fulfillment_errore: 'spedizione annullata: fulfillment annullato su Shopify',
          spedizione_id: null,
          stato: 'da_spedire',
        })
        .eq('id', ordine.id)
    } catch (e: any) {
      console.error('[SHOPIFY][ANNULLO FULFILLMENT]', ordine.numero_ordine, e?.message)
    }
  }
}
