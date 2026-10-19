import { wooGet } from '@/lib/woo'
import { rangeGiorniISO } from '@/lib/ebaySync'
import { contaStatiSincronizzati } from '@/lib/shopifySync'

// Sincronizza gli ordini WooCommerce NON SPEDITI (status processing + on-hold) in ordini_ecommerce,
// NELLA FINESTRA DATE RICHIESTA: si importa SOLO l'intervallo selezionato in pagina (oggi -> solo
// oggi; ieri -> solo ieri; il mese -> il mese). Default: ultimi 30 giorni.
export async function sincronizzaOrdiniWoo(db: any, integr: any, range?: { dal?: string | null; al?: string | null }, opz?: { pesoFrescoMs?: number }): Promise<{ letti: number; importati: number; spediti: number; daSpedire: number }> {
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

  // SOLO la FINESTRA scelta (per data di creazione): "oggi" chiede a Woo gli ordini di oggi, una
  // settimana quelli della settimana. NIENTE giro aggiuntivo "tutti i da spedire a prescindere dalla
  // data": c'era, e "sono pochi" non era vero — un negozio che non chiude mai gli ordini su Woo se ne
  // porta dietro centinaia (Deinature.it: 467, quasi tutti 2024-2025, 5 pagine da ~1,8 MB) e li
  // riscaricava a OGNI sync, manuale e cron. Il negozio andava in timeout (15/09/2026) e con lui
  // saltava anche la chiusura dei completed. Gli ordini nuovi li prende comunque il cron a rotazione
  // (finestra 7 giorni, sync-cron).
  for (let page = 1; page <= 50; page++) {
    const batch = await wooGet(url, ck, cs, `/orders?status=${stati}&after=${encodeURIComponent(daISO)}&before=${encodeURIComponent(aISO)}&per_page=100&page=${page}&orderby=date&order=desc`)
    if (!Array.isArray(batch) || !batch.length) break
    aggiungi(batch)
    if (batch.length < 100) break
  }

  // Con 'any' si esclude qui cio' che non e' "da spedire" (terminali, non pagati, bozze, gia' spediti).
  const daImportare = ordini.filter((o: any) => !(tuttiStati && ESCLUSI_ANY.has(String(o.status || '').toLowerCase())))
  // Il peso e' un di piu': se la lettura si rompe, gli ordini entrano lo stesso, senza peso come prima.
  let pesi = new Map<string, PesoArticolo>()
  try { pesi = await leggiPesiWoo(db, integr, url, ck, cs, daImportare, opz?.pesoFrescoMs ?? PESO_FRESCO_CRON_MS) }
  catch (e: any) { console.error('[WOO SYNC] pesi articoli (best-effort):', e?.message) }

  let importati = 0
  for (const o of daImportare) {
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
    const articoli = (o.line_items || []).map((li: any) => {
      const p = pesi.get(chiaveArticolo(li.product_id, li.variation_id))
      return {
        nome: li.name, quantita: li.quantity, grammi: p?.grammi || 0, sku: li.sku || '', immagine: li.image?.src || null,
        // Prodotto e variante servono a riconoscere l'articolo alla sync dopo, per riusarne il peso.
        prodotto_id: Number(li.product_id) || null, variante_id: Number(li.variation_id) || null,
        ...(p ? { peso_letto: p.letto } : {}),
      }
    })
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

  const { spediti, daSpedire } = await contaStatiSincronizzati(db, integr.id, ordini.map((o: any) => String(o.id)))
  return { letti: ordini.length, importati, spediti, daSpedire }
}

// PESO DEGLI ARTICOLI. WooCommerce non mette il peso nell'ordine: sta sul prodotto, o sulla variante
// quando il prodotto ne ha. Ed e' la variante a dirlo: Raccolto e Mangiato vende il mango da 1, da 4
// e da 8 kg con lo stesso SKU (108471), quindi ne' l'SKU ne' il catalogo bastano. Prima si salvava
// grammi: 0 per tutti e ogni ordine partiva su 1 kg (19/10/2026: 252 ordini su 252, anche il "da 30 kg").
//
// Il negozio puo' essere lento (quello sopra: ~5 secondi a chiamata, anche per una risposta vuota).
// Quindi: un peso letto si riusa, preso dagli articoli che abbiamo gia' salvato — un giorno per la sync
// automatica, pochi minuti per il tasto Sincronizza (chi lo preme ha appena corretto il negozio e vuole
// vedere il peso nuovo); le letture hanno un tempo massimo, e cio' che non si fa in tempo a rileggere
// TIENE L'ULTIMO PESO NOTO: un negozio lento o giu' non deve riportare a zero un peso buono. L'unita'
// non si indovina mai: se il negozio non la dice, niente pesi nuovi (500 letti come chili da un negozio
// che ragiona in grammi sono un pacco da mezza tonnellata).
type PesoArticolo = { grammi: number; letto: string }
export const PESO_FRESCO_CRON_MS = 24 * 3600 * 1000
export const PESO_FRESCO_MANUALE_MS = 10 * 60 * 1000
const PESO_TEMPO_MAX_MS = 20000
const PESO_LETTURE_INSIEME = 4
const PESO_ATTESA_MS = 10000      // per chiamata: una lettura appesa non deve allungare la sync oltre il tempo massimo
const GRAMMI_PER_UNITA: Record<string, number> = { kg: 1000, g: 1, lbs: 453.59237, oz: 28.349523125 }

const chiaveArticolo = (prodotto: unknown, variante: unknown) => `${Number(prodotto) || 0}:${Number(variante) || 0}`
const numeroWoo = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }

async function leggiPesiWoo(db: any, integr: any, url: string, ck: string, cs: string, ordini: any[], frescoMs: number): Promise<Map<string, PesoArticolo>> {
  const pesi = new Map<string, PesoArticolo>()
  const servono = new Set<string>()
  const chiaviDi = new Map<string, Set<string>>()
  for (const o of ordini) {
    const sue = new Set<string>()
    for (const li of o.line_items || []) if (Number(li.product_id) > 0) { const k = chiaveArticolo(li.product_id, li.variation_id); sue.add(k); servono.add(k) }
    chiaviDi.set(String(o.id), sue)
  }
  if (!servono.size) return pesi

  // Pesi gia' letti: stanno sugli articoli degli stessi ordini, salvati alle sync precedenti. La
  // finestra della sync automatica e' di sette giorni, quindi qui c'e' quasi tutto il venduto recente.
  // Si prendono solo gli articoli che l'ordine ha ANCORA sul negozio: il capofila di un'unione porta
  // anche le righe degli ordini assorbiti, magari di un altro negozio, dove lo stesso id e' un altro prodotto.
  const noti = new Map<string, PesoArticolo>()
  const ids = [...chiaviDi.keys()]
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('ordini_ecommerce').select('ordine_esterno_id,articoli')
      .eq('integrazione_id', integr.id).in('ordine_esterno_id', ids.slice(i, i + 200))
    for (const r of data || []) for (const a of Array.isArray(r.articoli) ? r.articoli : []) {
      const letto = Date.parse(a?.peso_letto || '')
      if (!a?.prodotto_id || !Number.isFinite(letto)) continue
      const k = chiaveArticolo(a.prodotto_id, a.variante_id)
      if (!chiaviDi.get(String(r.ordine_esterno_id))?.has(k)) continue
      const gia = noti.get(k)
      if (!gia || Date.parse(gia.letto) < letto) noti.set(k, { grammi: Number(a.grammi) || 0, letto: a.peso_letto })
    }
  }
  const oraMs = Date.now()
  for (const [k, p] of noti) if (oraMs - Date.parse(p.letto) < frescoMs) pesi.set(k, p)
  const mancanti = [...servono].filter(k => !pesi.has(k))
  // Cio' che non si e' riletto tiene il peso di prima, con la sua data: la prossima sync lo riprova.
  const conUltimiNoti = () => { for (const k of mancanti) if (!pesi.has(k) && noti.has(k)) pesi.set(k, noti.get(k)!); return pesi }
  if (!mancanti.length) return pesi

  const scadenza = Date.now() + PESO_TEMPO_MAX_MS
  let unita = ''
  try { unita = String((await wooGet(url, ck, cs, '/settings/products/woocommerce_weight_unit', PESO_ATTESA_MS))?.value || '') } catch {}
  if (!unita) { try { unita = String((await wooGet(url, ck, cs, '/system_status?_fields=settings', PESO_ATTESA_MS))?.settings?.weight_unit || '') } catch {} }
  const perUnita = GRAMMI_PER_UNITA[unita.toLowerCase()]
  if (!perUnita) { console.error('[WOO SYNC] pesi: unita\' di peso del negozio non leggibile', integr.id, unita || '(vuota)'); return conUltimiNoti() }

  // Prodotti e varianti, queste raggruppate per prodotto. Nelle due mappe: un numero = letto (0 = il
  // negozio non ha un peso); null = il negozio non lo restituisce piu' (cancellato); assente = lettura
  // non riuscita, si riprova alla prossima.
  const prodotti = [...new Set(mancanti.map(k => k.split(':')[0]))]
  const variantiPer = new Map<string, string[]>()
  for (const k of mancanti) { const [p, v] = k.split(':'); if (v !== '0') variantiPer.set(p, [...(variantiPer.get(p) || []), v]) }
  const pesoProdotto = new Map<string, number | null>(), pesoVariante = new Map<string, number | null>()
  const compiti: (() => Promise<void>)[] = []
  for (let i = 0; i < prodotti.length; i += 100) {
    const blocco = prodotti.slice(i, i + 100)
    compiti.push(async () => {
      const ps = await wooGet(url, ck, cs, `/products?include=${blocco.join(',')}&per_page=100&_fields=id,weight`, PESO_ATTESA_MS)
      if (!Array.isArray(ps)) return
      for (const id of blocco) pesoProdotto.set(id, null)
      for (const p of ps) pesoProdotto.set(String(p.id), numeroWoo(p.weight))
    })
  }
  for (const [p, vs] of variantiPer) {
    for (let i = 0; i < vs.length; i += 100) {
      const blocco = vs.slice(i, i + 100)
      compiti.push(async () => {
        const rs = await wooGet(url, ck, cs, `/products/${p}/variations?include=${blocco.join(',')}&per_page=100&_fields=id,weight`, PESO_ATTESA_MS)
        if (!Array.isArray(rs)) return
        for (const v of blocco) pesoVariante.set(`${p}:${v}`, null)
        for (const v of rs) pesoVariante.set(`${p}:${v.id}`, numeroWoo(v.weight))
      })
    }
  }
  let prossimo = 0
  const lettore = async () => {
    while (prossimo < compiti.length && Date.now() < scadenza) {
      const c = compiti[prossimo++]
      try { await c() } catch (e: any) { console.error('[WOO SYNC] pesi: lettura fallita', integr.id, String(e?.message || e).slice(0, 120)) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PESO_LETTURE_INSIEME, compiti.length) }, lettore))

  const letto = new Date().toISOString()
  for (const k of mancanti) {
    const [p, v] = k.split(':')
    if (!pesoProdotto.has(p)) continue
    const pp = pesoProdotto.get(p)
    let peso: number
    if (pp === null) peso = 0                                // prodotto cancellato: nessun peso
    else if (v === '0') peso = pp || 0
    else {
      if (!pesoVariante.has(k)) continue
      const pv = pesoVariante.get(k)
      // Variante senza peso proprio: quello del prodotto, come fa WooCommerce stesso. Variante
      // CANCELLATA invece no: il peso del prodotto sarebbe un peso indovinato (il mango da 8 kg a 1 kg).
      peso = pv === null ? 0 : (pv || pp || 0)
    }
    // Anche "nessun peso sul negozio" si ricorda: rileggerlo a ogni sync non lo farebbe comparire.
    pesi.set(k, { grammi: Math.round(peso * perUnita), letto })
  }
  return conUltimiNoti()
}
