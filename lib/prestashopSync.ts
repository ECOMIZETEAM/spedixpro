import { psGet } from '@/lib/prestashop'

// Sincronizza gli ordini PrestaShop pagati/validi in ordini_ecommerce.
// PrestaShop normalizza i dati: ordine → indirizzo → cliente → stato/paese (risorse separate),
// quindi per ogni ordine risolviamo indirizzo + email + provincia + paese (con cache).
export async function sincronizzaOrdiniPrestashop(db: any, integr: any): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const url = cred?.url, key = cred?.key
  if (!url || !key) throw new Error('Credenziali PrestaShop mancanti')

  const ordRes = await psGet(url, key, 'orders?display=full&filter[valid]=[1]&sort=[id_DESC]&limit=50')
  const ordini: any[] = ordRes?.orders || []

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
      stato_pagamento: String(o.current_state || ''),
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
