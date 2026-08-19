import { createServerSupabase } from '@/lib/supabase'

const API_VERSION = '2026-04'

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
export async function shopifyGraphQL(shop: string, token: string, query: string, variables?: any): Promise<any> {
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
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${raw.slice(0, 150)}`)
  if (d?.errors) {
    const msg = Array.isArray(d.errors) ? d.errors.map((e: any) => e.message).join('; ') : JSON.stringify(d.errors)
    throw new Error('Shopify: ' + String(msg).slice(0, 220))
  }
  return d?.data
}

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
        .from('spedizioni').select('tracking_number, corrieri(nome_contratto)')
        .eq('id', ordine.spedizione_id).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
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
      // 1) fulfillment orders aperti dell'ordine (GraphQL)
      const gid = `gid://shopify/Order/${ordine.ordine_esterno_id}`
      const dFo = await shopifyGraphQL(shop, tk.token,
        `query($id: ID!){ order(id:$id){ fulfillmentOrders(first:10){ edges{ node{ id status } } } } }`,
        { id: gid })
      const aperti = ((dFo?.order?.fulfillmentOrders?.edges) || [])
        .map((e: any) => e.node)
        .filter((f: any) => ['OPEN', 'IN_PROGRESS', 'SCHEDULED'].includes(f.status))
      if (!aperti.length) { await segna('ok', 'gia evaso su Shopify'); continue }
      // 2) crea fulfillment con tracking su tutti i fulfillment orders aperti (GraphQL)
      const dF = await shopifyGraphQL(shop, tk.token,
        `mutation($f: FulfillmentV2Input!){ fulfillmentCreateV2(fulfillment:$f){ fulfillment{ id status } userErrors{ field message } } }`,
        { f: {
            notifyCustomer: true,
            trackingInfo: { number: tracking, company },
            lineItemsByFulfillmentOrder: aperti.map((f: any) => ({ fulfillmentOrderId: f.id })),
        } })
      const errs = dF?.fulfillmentCreateV2?.userErrors || []
      if (errs.length) { await segna('errore', errs.map((e: any) => e.message).join('; ').slice(0, 150)); continue }
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
