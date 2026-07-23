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

  // ── CLIENT CREDENTIALS GRANT (via primaria) ─────────────────────────────────
  // Shopify NON accetta piu' i token offline non scadenti ("Non-expiring access tokens are
  // no longer accepted"): i token salvati dai vecchi collegamenti sono morti. Con questo grant
  // si conia un token a scadenza (24h) per ogni negozio che ha l'app installata, al volo.
  if (cred.cc_token && cred.cc_expires_at && Number(cred.cc_expires_at) - now > 5 * 60 * 1000) {
    return { token: cred.cc_token }
  }
  const ccKey = process.env.SHOPIFY_API_KEY
  const ccSecret = process.env.SHOPIFY_API_SECRET
  if (ccKey && ccSecret) {
    try {
      const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: ccKey, client_secret: ccSecret, grant_type: 'client_credentials' }),
      })
      const raw = await r.text()
      let d: any = null
      try { d = JSON.parse(raw) } catch {}
      if (r.ok && d?.access_token) {
        const newCred = { ...cred, shop, cc_token: d.access_token, cc_expires_at: now + (Number(d.expires_in) || 86400) * 1000 }
        try {
          const supabase = db || await createServerSupabase()
          await supabase.from('integrazioni').update({ credenziali: newCred }).eq('id', integrazione.id)
        } catch { /* il token vale comunque per questa richiesta */ }
        return { token: d.access_token }
      }
      console.log('[SHOPIFY] client_credentials fallito per', shop, ':', String(raw).slice(0, 180))
    } catch (e: any) {
      console.log('[SHOPIFY] client_credentials errore per', shop, ':', e?.message || e)
    }
  }

  // ── Fallback legacy: token salvato / refresh (vecchi collegamenti) ──────────
  if (!token) return { error: 'Sessione Shopify scaduta. Ricollega il negozio dalle Integrazioni.' }

  // Token ancora valido (con margine di 5 minuti)? Usalo.
  if (!expiresAt || expiresAt - now > 5 * 60 * 1000) {
    return { token }
  }

  // Vecchi token a scadenza: provo a rinnovare col refresh token. Se non c'e' o il
  // rinnovo fallisce, chiedo di ricollegare il negozio (i nuovi collegamenti usano
  // token offline che non scadono, quindi questo ramo riguarda solo vecchie connessioni).
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
  if (r.status === 403 || r.status === 401) {
    // Tipico su app appena create: dati cliente protetti non approvati o scope ordini mancante
    throw new Error('Shopify ha negato l\'accesso agli ordini (HTTP ' + r.status + '). Verifica nel Partner Dashboard di aver richiesto e ottenuto l\'accesso ai "Protected customer data" e lo scope read_orders, poi ricollega il negozio.')
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
      const tk = await getValidShopifyToken(integr)
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
