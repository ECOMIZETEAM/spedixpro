import { wooGet } from '@/lib/woo'
import { rangeGiorniISO } from '@/lib/ebaySync'

// Sincronizza gli ordini WooCommerce NON SPEDITI (status processing + on-hold) in ordini_ecommerce,
// NELLA FINESTRA DATE RICHIESTA: si importa SOLO l'intervallo selezionato in pagina (oggi -> solo
// oggi; ieri -> solo ieri; il mese -> il mese). Default: ultimi 30 giorni.
export async function sincronizzaOrdiniWoo(db: any, integr: any, range?: { dal?: string | null; al?: string | null }): Promise<{ letti: number; importati: number }> {
  const cred = integr.credenziali as any
  const url = cred?.url, ck = cred?.ck, cs = cred?.cs
  if (!url || !ck || !cs) throw new Error('Credenziali WooCommerce mancanti')

  // Ordini "da spedire" = non ancora evasi: default stati processing (pagato) + on-hold (bonifico/COD
  // in attesa, che molti negozi spediscono comunque). Gli spediti (completed) NON si importano.
  // STATI CONFIGURABILI per negozio (credenziali.stati_ordini): un negozio che usa uno STATO
  // PERSONALIZZATO (che il default non intercetta) lo aggiunge qui e i suoi ordini tornano a comparire
  // nel portale. Si toglie un eventuale prefisso 'wc-' (la REST vuole lo slug nudo) e si scarta
  // 'completed' (sono gli spediti, gestiti a parte sotto: non vanno importati come "da spedire").
  const statiRaw = String(cred?.stati_ordini || '').trim().toLowerCase()
  // 'any' (o 'tutti'/'*') = importa TUTTI gli stati Woo, custom compresi — come faceva il vecchio
  // provider. Si scartano solo i terminali/non pagati/bozze/gia' spediti (ESCLUSI_ANY, filtrati sotto).
  const tuttiStati = statiRaw === 'any' || statiRaw === 'tutti' || statiRaw === '*'
  const stati = tuttiStati
    ? 'any'
    : (statiRaw
        ? (statiRaw.split(',').map((x: string) => x.trim().replace(/^wc-/, '')).filter(Boolean).filter((x: string) => x !== 'completed').join(',') || 'processing,on-hold')
        : 'processing,on-hold')
  const ESCLUSI_ANY = new Set(['completed', 'cancelled', 'refunded', 'failed', 'trash', 'checkout-draft', 'auto-draft', 'pending'])
  const { daISO, aISO } = rangeGiorniISO(range?.dal, range?.al)
  const ordini: any[] = []
  const visti = new Set<string>()
  const aggiungi = (batch: any[]) => { for (const o of batch) { const id = String(o.id); if (!visti.has(id)) { visti.add(id); ordini.push(o) } } }

  // 1) La FINESTRA scelta (per data di creazione).
  for (let page = 1; page <= 50; page++) {
    const batch = await wooGet(url, ck, cs, `/orders?status=${stati}&after=${encodeURIComponent(daISO)}&before=${encodeURIComponent(aISO)}&per_page=100&page=${page}&orderby=date&order=desc`)
    if (!Array.isArray(batch) || !batch.length) break
    aggiungi(batch)
    if (batch.length < 100) break
  }

  // 2) TUTTI gli ordini ANCORA DA SPEDIRE (processing/on-hold) a PRESCINDERE dalla data: un ordine
  //    pagato ma non ancora evaso puo' essere piu' VECCHIO della finestra e va comunque importato —
  //    era il "non me li importa tutti" (stessa cosa gia' risolta per eBay). Sono pochi ed
  //    esattamente quelli da spedire. Best-effort + DEDUP: se fallisce, l'import della finestra resta.
  try {
    for (let page = 1; page <= 50; page++) {
      const batch = await wooGet(url, ck, cs, `/orders?status=${stati}&per_page=100&page=${page}&orderby=date&order=desc`)
      if (!Array.isArray(batch) || !batch.length) break
      aggiungi(batch)
      if (batch.length < 100) break
    }
  } catch (e: any) { console.error('[WOO SYNC] fetch ordini da evadere (best-effort):', e?.message) }

  let importati = 0
  for (const o of ordini) {
    // Con 'any' si esclude qui cio' che non e' "da spedire" (terminali, non pagati, bozze, gia' spediti).
    if (tuttiStati && ESCLUSI_ANY.has(String(o.status || '').toLowerCase())) continue
    const sh = o.shipping || {}
    const bi = o.billing || {}
    const src = sh.address_1 ? sh : bi   // usa spedizione se presente, altrimenti fatturazione
    const destinatario = {
      nome: `${src.first_name || ''} ${src.last_name || ''}`.trim() || `${bi.first_name || ''} ${bi.last_name || ''}`.trim(),
      indirizzo: [src.address_1, src.address_2].filter(Boolean).join(' '),
      citta: src.city || '',
      provincia: src.state || '',
      cap: src.postcode || '',
      paese: src.country || 'IT',
      email: bi.email || '',
      telefono: src.phone || bi.phone || '',
    }
    const articoli = (o.line_items || []).map((li: any) => ({
      nome: li.name, quantita: li.quantity, grammi: 0, sku: li.sku || '', immagine: li.image?.src || null,
    }))
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      // Dominio del negozio SULLA riga: i redact GDPR filtrano su questo. Non su integrazione_id,
      // che sparisce se qualcuno cancella l'integrazione e lascia gli ordini orfani — e un ordine
      // orfano nessuna cancellazione lo raggiunge piu' (erano 4.147 il 9/09/2026).
      shop: integr.identificativo,
      piattaforma: 'woocommerce',
      ordine_esterno_id: String(o.id),
      numero_ordine: o.number ? `#${o.number}` : String(o.id),
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: o.total ? Number(o.total) : null,
      valuta: o.currency || 'EUR',
      stato_pagamento: o.status || '',
      raw: o,
    }
    const { error } = await db.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  // CHIUSURA: gli ordini che il merchant porta a 'completed' su Woo (fuori dal nostro portale) escono
  // da processing/on-hold e non li rileggiamo piu' -> restavano 'da_spedire' PER SEMPRE nel nostro
  // portale, col bottone "Crea spedizione" attivo = rischio DOPPIA spedizione. Come Shopify/eBay/Presta,
  // recupero i 'completed' della finestra e segno 'spedito' le SOLE righe corrispondenti ancora
  // 'da_spedire' (mai declassare chi abbiamo gia' spedito noi: la guardia .eq('stato','da_spedire') lo
  // garantisce). Best-effort: se fallisce, l'import della finestra resta valido.
  try {
    const completati = new Set<string>()
    for (let page = 1; page <= 50; page++) {
      const batch = await wooGet(url, ck, cs, `/orders?status=completed&after=${encodeURIComponent(daISO)}&before=${encodeURIComponent(aISO)}&per_page=100&page=${page}&orderby=date&order=desc`)
      if (!Array.isArray(batch) || !batch.length) break
      for (const o of batch) completati.add(String(o.id))
      if (batch.length < 100) break
    }
    const ids = Array.from(completati)
    for (let i = 0; i < ids.length; i += 200) {
      await db.from('ordini_ecommerce').update({ stato: 'spedito' })
        .eq('integrazione_id', integr.id).eq('stato', 'da_spedire')
        .in('ordine_esterno_id', ids.slice(i, i + 200))
    }
  } catch (e: any) { console.error('[WOO SYNC] chiusura completed (best-effort):', e?.message) }

  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length, errore: null })   // sync riuscita: azzera un errore precedente
    .eq('id', integr.id)

  return { letti: ordini.length, importati }
}
