import { psGet } from '@/lib/prestashop'

// Sincronizza gli ordini PrestaShop pagati/validi in ordini_ecommerce.
// PrestaShop normalizza i dati: ordine → indirizzo → cliente → stato/paese (risorse separate),
// quindi per ogni ordine risolviamo indirizzo + email + provincia + paese (con cache).
export async function sincronizzaOrdiniPrestashop(db: any, integr: any, range?: { dal?: string; al?: string }): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const url = cred?.url, key = cred?.key
  if (!url || !key) throw new Error('Credenziali PrestaShop mancanti')

  // FILTRO PERIODO guidato dalla pagina (come eBay/Woo): la sintassi intervallo date-only
  // e' verificata su negozio reale. Senza periodo: ultimi 100 ordini validi.
  const filtroData = (range?.dal && range?.al) ? `&filter[date_add]=[${range.dal},${range.al}]&date=1` : ''
  const ordRes = await psGet(url, key, `orders?display=full&filter[valid]=[1]&sort=[id_DESC]&limit=100${filtroData}`)
  const ordini: any[] = ordRes?.orders || []

  // STATI ORDINE del negozio: il flag 'shipped' dice se lo stato equivale a "spedito"
  // (NB: NON usare 'delivery': su negozi reali "Preparazione in corso" ha delivery=1 ma shipped=0).
  // Serve per (a) marcare gli ordini gia' evasi e (b) mostrare il NOME dello stato, non il numero.
  const statoInfo = new Map<string, { nome: string; spedito: boolean }>()
  try {
    const st = await psGet(url, key, 'order_states?display=full')
    for (const x of (st?.order_states || [])) {
      let nome = ''
      if (typeof x?.name === 'string') nome = x.name
      else if (Array.isArray(x?.name)) nome = x.name[0]?.value || ''
      else if (x?.name && typeof x.name === 'object') nome = Object.values(x.name)[0] as string || ''
      statoInfo.set(String(x.id), { nome: nome || String(x.id), spedito: String(x.shipped) === '1' })
    }
  } catch { /* fallback: numeri grezzi, nessun ordine marcato spedito */ }

  // Ordini gia' spediti DA NOI (spedizione collegata o stato spedito): mai declassare a 'da_spedire'
  // per colpa di un negozio non ancora aggiornato.
  const giaSpediti = new Set<string>()
  try {
    const { data: esistenti } = await db.from('ordini_ecommerce')
      .select('ordine_esterno_id,stato,spedizione_id').eq('integrazione_id', integr.id)
    for (const e of (esistenti || [])) if (e.stato === 'spedito' || e.spedizione_id) giaSpediti.add(String(e.ordine_esterno_id))
  } catch { /* best-effort */ }

  const stateCache = new Map<string, string>()
  const countryCache = new Map<string, string>()
  async function statoIso(id: any): Promise<string> {
    const k = String(id || '')
    if (!k || k === '0') return ''
    if (stateCache.has(k)) return stateCache.get(k)!
    try { const d = await psGet(url, key, `states/${k}`); const iso = d?.state?.iso_code || ''; stateCache.set(k, iso); return iso } catch { return '' }
  }
  async function paeseIso(id: any): Promise<string> {
    const k = String(id || '')
    if (!k) return 'IT'
    if (countryCache.has(k)) return countryCache.get(k)!
    try { const d = await psGet(url, key, `countries/${k}`); const iso = d?.country?.iso_code || 'IT'; countryCache.set(k, iso); return iso } catch { return 'IT' }
  }

  let importati = 0
  for (const o of ordini) {
    let addr: any = null, cust: any = null
    try { const a = await psGet(url, key, `addresses/${o.id_address_delivery}`); addr = a?.address } catch {}
    try { const c = await psGet(url, key, `customers/${o.id_customer}`); cust = c?.customer } catch {}
    const prov = await statoIso(addr?.id_state)
    const paese = await paeseIso(addr?.id_country)

    const destinatario = {
      nome: `${addr?.firstname || ''} ${addr?.lastname || ''}`.trim(),
      indirizzo: [addr?.address1, addr?.address2].filter(Boolean).join(' '),
      citta: addr?.city || '',
      provincia: prov,
      cap: addr?.postcode || '',
      paese: paese || 'IT',
      email: cust?.email || '',
      telefono: addr?.phone_mobile || addr?.phone || '',
    }
    const rows = o.associations?.order_rows || []
    const articoli = rows.map((r: any) => ({
      nome: r.product_name, quantita: Number(r.product_quantity) || 1, grammi: 0, sku: r.product_reference || '', immagine: null,
    }))
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      piattaforma: 'prestashop',
      ordine_esterno_id: String(o.id),
      numero_ordine: o.reference || `#${o.id}`,
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: o.total_paid ? Number(o.total_paid) : null,
      valuta: 'EUR',
      stato_pagamento: statoInfo.get(String(o.current_state || ''))?.nome || String(o.current_state || ''),
      stato: (statoInfo.get(String(o.current_state || ''))?.spedito || giaSpediti.has(String(o.id))) ? 'spedito' : 'da_spedire',
      raw: o,
    }
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length })
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
