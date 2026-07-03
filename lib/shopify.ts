import { createServerSupabase } from '@/lib/supabase'

const API_VERSION = '2026-04'

// Restituisce un access token Shopify valido per l'integrazione data.
// Se il token e' scaduto (o sta per scadere), lo rifresca col refresh token
// e aggiorna le credenziali salvate. Ritorna { token } oppure { error }.
export async function getValidShopifyToken(integrazione: any): Promise<{ token?: string; error?: string }> {
  const cred = (integrazione?.credenziali || {}) as any
  const shop = cred.shop
  const token = cred.access_token
  const refreshToken = cred.refresh_token
  const expiresAt = cred.expires_at ? Number(cred.expires_at) : null

  if (!shop || !token) return { error: 'Credenziali Shopify mancanti' }

  // Token ancora valido (con margine di 5 minuti)? Usalo.
  const now = Date.now()
  if (!expiresAt || expiresAt - now > 5 * 60 * 1000) {
    return { token }
  }

  // Scaduto o in scadenza: rifresca col refresh token
  if (!refreshToken) {
    return { error: 'Token scaduto e nessun refresh token disponibile. Ricollega il negozio.' }
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
    const d = await r.json()
    if (!d.access_token) return { error: 'Refresh token fallito: ' + JSON.stringify(d).slice(0, 200) }

    const n = Date.now()
    const newCred = {
      ...cred,
      access_token: d.access_token,
      refresh_token: d.refresh_token || refreshToken,
      expires_at: d.expires_in ? n + Number(d.expires_in) * 1000 : null,
      refresh_expires_at: d.refresh_token_expires_in ? n + Number(d.refresh_token_expires_in) * 1000 : cred.refresh_expires_at,
    }
    const supabase = await createServerSupabase()
    await supabase.from('integrazioni').update({ credenziali: newCred }).eq('id', integrazione.id)
    return { token: d.access_token }
  } catch (e: any) {
    return { error: 'Errore refresh token: ' + (e?.message || e) }
  }
}

export { API_VERSION }

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
      const hdr = { 'X-Shopify-Access-Token': tk.token, 'Content-Type': 'application/json' }
      // 1) fulfillment orders dell'ordine
      const rFo = await fetch(`https://${shop}/admin/api/${API_VERSION}/orders/${ordine.ordine_esterno_id}/fulfillment_orders.json`, { headers: hdr })
      if (!rFo.ok) { await segna('errore', 'fulfillment_orders HTTP ' + rFo.status); continue }
      const dFo = await rFo.json()
      const aperti = (dFo.fulfillment_orders || []).filter((f: any) => ['open', 'in_progress', 'scheduled'].includes(f.status))
      if (!aperti.length) { await segna('ok', 'gia evaso su Shopify'); continue }
      // 2) crea fulfillment con tracking su tutti i fulfillment orders aperti
      const rF = await fetch(`https://${shop}/admin/api/${API_VERSION}/fulfillments.json`, {
        method: 'POST', headers: hdr,
        body: JSON.stringify({
          fulfillment: {
            notify_customer: true,
            tracking_info: { number: tracking, company },
            line_items_by_fulfillment_order: aperti.map((f: any) => ({ fulfillment_order_id: f.id })),
          },
        }),
      })
      if (!rF.ok) {
        const t = await rF.text()
        await segna('errore', 'fulfillment HTTP ' + rF.status + ': ' + t.slice(0, 150))
        continue
      }
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
