import { psGet } from '@/lib/prestashop'

// Sincronizza gli ordini PrestaShop pagati/validi in ordini_ecommerce.
// PrestaShop normalizza i dati: ordine → indirizzo → cliente → stato/paese (risorse separate),
// quindi per ogni ordine risolviamo indirizzo + email + provincia + paese (con cache).
export async function sincronizzaOrdiniPrestashop(db: any, integr: any, range?: { dal?: string; al?: string }): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const url = cred?.url, key = cred?.key
  if (!url || !key) throw new Error('Credenziali PrestaShop mancanti')

  // STATI ORDINE del negozio PRIMA di tutto: servono sia a marcare gli evasi sia al catch-all dei NON
  // evasi qui sotto. 'shipped'=1 → lo stato equivale a "spedito" (NON usare 'delivery': su negozi reali
  // "Preparazione in corso" ha delivery=1 ma shipped=0). Serve anche per mostrare il NOME dello stato.
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

  // FETCH PAGINATO: col solo `limit=100` PrestaShop tornava AL MASSIMO 100 ordini e il resto spariva —
  // era il "non li importa tutti". Ora si scorre a pagine (limit=offset,100) finche' non si esaurisce.
  const fetchPaginato = async (queryFiltri: string): Promise<any[]> => {
    const out: any[] = []
    for (let page = 0; page < 50; page++) {
      const res = await psGet(url, key, `orders?display=full&${queryFiltri}sort=[id_DESC]&limit=${page * 100},100`)
      const batch: any[] = res?.orders || []
      out.push(...batch)
      if (batch.length < 100) break
    }
    return out
  }

  const ordini: any[] = []
  const visti = new Set<string>()
  const aggiungi = (arr: any[]) => { for (const o of arr) { const id = String(o.id); if (!visti.has(id)) { visti.add(id); ordini.push(o) } } }

  // 1) FINESTRA: ordini validi nell'intervallo scelto (default ultimi 30 giorni, come gli altri sync).
  const oggi = new Date().toISOString().slice(0, 10)
  const dal = (range?.dal && /^\d{4}-\d{2}-\d{2}$/.test(range.dal)) ? range.dal : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const al = (range?.al && /^\d{4}-\d{2}-\d{2}$/.test(range.al)) ? range.al : oggi
  aggiungi(await fetchPaginato(`filter[valid]=[1]&filter[date_add]=[${dal},${al}]&date=1&`))

  // 2) CATCH-ALL: tutti gli ordini validi ANCORA DA SPEDIRE a prescindere dalla data (stati non
  //    'shipped'). Un ordine pagato ma non evaso puo' essere piu' vecchio della finestra e va comunque
  //    importato — come per eBay/Woo. La coda dei non evasi e' piccola, quindi il costo e' contenuto.
  const nonSpediti = [...statoInfo.entries()].filter(([, v]) => !v.spedito).map(([id]) => id)
  if (nonSpediti.length) {
    try { aggiungi(await fetchPaginato(`filter[valid]=[1]&filter[current_state]=[${nonSpediti.join('|')}]&`)) }
    catch (e: any) { console.error('[PRESTA SYNC] catch-all non evasi (best-effort):', e?.message) }
  }

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
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length, errore: null })   // sync riuscita: azzera un errore precedente (non piu' appiccicato quando lo store rientra)
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
