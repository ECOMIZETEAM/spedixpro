import { wooGet } from '@/lib/woo'
import { rangeGiorniISO } from '@/lib/ebaySync'
import { contaStatiSincronizzati } from '@/lib/shopifySync'

// Sincronizza gli ordini WooCommerce NON SPEDITI (status processing + on-hold) in ordini_ecommerce,
// NELLA FINESTRA DATE RICHIESTA: si importa SOLO l'intervallo selezionato in pagina (oggi -> solo
// oggi; ieri -> solo ieri; il mese -> il mese). Default: ultimi 30 giorni.
export async function sincronizzaOrdiniWoo(db: any, integr: any, range?: { dal?: string | null; al?: string | null }, opz?: { pesoFrescoMs?: number }): Promise<{ letti: number; importati: number; spediti: number; daSpedire: number; annullati: number }> {
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
  // Quali stati del negozio RIAPRONO un ordine che avevamo segnato annullato. Con 'any' solo quelli
  // standard: uno stato personalizzato dopo un annullo ("reso", "rimborso richiesto") non e' merce da
  // spedire, anche se l'import con 'any' lo prenderebbe.
  const statiDaSpedire = new Set(tuttiStati ? ['processing', 'on-hold'] : stati.split(','))

  // Le righe che abbiamo gia' per questi ordini: servono ai pesi (quelli gia' letti) e alle unioni.
  const esistenti = await righeEsistenti(db, integr.id, daImportare.map((o: any) => String(o.id)))
  // CAPOFILA DI UN'UNIONE: i suoi articoli e il totale sono quelli di tutti gli ordini uniti nel pacco
  // (app/api/ordini/unisci). Riscriverli con le sole righe del suo ordine, a ogni sync, faceva pesare il
  // pacco quanto il capofila e riportava il contrassegno al totale del solo capofila.
  const capofila = await capofilaDiUnioni(db, [...esistenti.values()].map(r => r.id))

  // Pesi e stati sono due letture indipendenti dal negozio: insieme, non una dopo l'altra (su un
  // negozio lento ogni chiamata costa secondi). Tutte e due sono un di piu': se si rompono, gli ordini
  // entrano lo stesso.
  // I capofila non riscrivono gli articoli: leggerne i pesi sarebbe una lettura buttata a ogni sync.
  const nonCapofila = daImportare.filter((o: any) => !capofila.has(esistenti.get(String(o.id))?.id || ''))
  const [esitoPesi, esitoStati] = await Promise.allSettled([
    leggiPesiWoo(integr, url, ck, cs, nonCapofila, esistenti, opz?.pesoFrescoMs ?? PESO_FRESCO_CRON_MS),
    allineaStatiWoo(db, integr, url, ck, cs, statiDaSpedire, new Set(daImportare.map((o: any) => String(o.id))), daISO),
  ])
  const pesi = esitoPesi.status === 'fulfilled' ? esitoPesi.value : new Map<string, PesoArticolo>()
  if (esitoPesi.status === 'rejected') console.error('[WOO SYNC] pesi articoli (best-effort):', esitoPesi.reason?.message)
  const annullati = esitoStati.status === 'fulfilled' ? esitoStati.value : 0
  if (esitoStati.status === 'rejected') console.error('[WOO SYNC] allineamento stati (best-effort):', integr.id, esitoStati.reason?.message)

  const righe: any[] = []
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
    if (capofila.has(esistenti.get(String(o.id))?.id || '')) { delete payload.articoli; delete payload.totale }
    righe.push(payload)
  }

  // Scrittura A BLOCCHI, come PrestaShop: una chiamata ogni cinquanta ordini invece di una per ordine.
  // Nello stesso blocco solo righe con le stesse colonne (i capofila non riscrivono articoli e totale).
  // Se un blocco viene rifiutato si riprova riga per riga: una riga storta non si porta dietro le altre.
  let importati = 0
  let primoErrore = ''
  const scrivi = async (blocco: any[]) => db.from('ordini_ecommerce').upsert(blocco, { onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false })
  for (const gruppo of [righe.filter(r => 'articoli' in r), righe.filter(r => !('articoli' in r))]) {
    for (let i = 0; i < gruppo.length; i += 50) {
      const blocco = gruppo.slice(i, i + 50)
      const { error } = await scrivi(blocco)
      if (!error) { importati += blocco.length; continue }
      for (const r of blocco) {
        const { error: e1 } = await scrivi([r])
        if (!e1) importati++; else if (!primoErrore) primoErrore = e1.message
      }
    }
  }
  if (primoErrore) console.error('[WOO SYNC]', integr.identificativo, 'ordini non scritti:', righe.length - importati, primoErrore)

  // Quanti ordini ha DAVVERO questo negozio da noi, non quanti ne ha letti l'ultimo giro (come
  // PrestaShop): dopo una sync del solo "oggi" la scheda del negozio diceva "0 ordini".
  const { count } = await db.from('ordini_ecommerce').select('id', { count: 'exact', head: true }).eq('integrazione_id', integr.id)
  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: count ?? ordini.length, errore: null })   // sync riuscita: azzera un errore precedente
    .eq('id', integr.id)

  const { spediti, daSpedire } = await contaStatiSincronizzati(db, integr.id, ordini.map((o: any) => String(o.id)))
  return { letti: ordini.length, importati, spediti, daSpedire, annullati }
}

type RigaEsistente = { id: string; articoli: any[] }
async function righeEsistenti(db: any, integrazioneId: string, ids: string[]): Promise<Map<string, RigaEsistente>> {
  const m = new Map<string, RigaEsistente>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('ordini_ecommerce').select('id,ordine_esterno_id,articoli')
      .eq('integrazione_id', integrazioneId).in('ordine_esterno_id', ids.slice(i, i + 200))
    // Senza sapere quali righe ci sono non si sa chi e' capofila: meglio una sync fallita (si riprova)
    // che articoli e totale di un pacco unito riscritti.
    if (error) throw new Error('lettura ordini esistenti: ' + error.message)
    for (const r of data || []) m.set(String(r.ordine_esterno_id), { id: r.id, articoli: Array.isArray(r.articoli) ? r.articoli : [] })
  }
  return m
}

async function capofilaDiUnioni(db: any, ids: string[]): Promise<Set<string>> {
  const s = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('ordini_ecommerce').select('unito_in').in('unito_in', ids.slice(i, i + 200))
    if (error) throw new Error('lettura unioni: ' + error.message)
    for (const r of data || []) if (r.unito_in) s.add(String(r.unito_in))
  }
  return s
}

// Esegue i compiti QUANTI alla volta, e non ne avvia di nuovi dopo la scadenza. Un compito che fallisce
// non ferma gli altri: chi lo chiama decide che cosa vuol dire una lettura mancata.
async function inParallelo(compiti: (() => Promise<void>)[], quanti: number, scadenza: number, etichetta: string, integrazioneId: string) {
  let prossimo = 0
  const lettore = async () => {
    while (prossimo < compiti.length && Date.now() < scadenza) {
      const c = compiti[prossimo++]
      try { await c() } catch (e: any) { console.error(`[WOO SYNC] ${etichetta}: lettura fallita`, integrazioneId, String(e?.message || e).slice(0, 120)) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(quanti, compiti.length) }, lettore))
}

// ALLINEAMENTO DEGLI STATI, come PrestaShop (13/10/2026). Un ordine che il negozio annulla o rimborsa
// DOPO l'import da noi restava "Da spedire" per sempre, spedibile; uno segnato completato sul negozio si
// chiudeva solo se cadeva nella finestra della sync. E per saperlo si scaricavano TUTTI i completati
// della finestra, ordini interi: su un negozio da 200 pacchi al giorno, la parte piu' lenta della sync.
// Ora si chiede al negozio lo stato dei soli ordini ancora aperti da noi (id e stato, cento a chiamata)
// e si correggono le sole righe mai spedite da noi. Misurato il 19/10/2026, prima di attivarlo: 478
// ordini aperti da noi su 46 negozi erano gia' completati (288), annullati (137) o rimborsati (53) sul
// negozio, 11 di quella settimana. Un ordine che il negozio non restituisce (cestinato) o in uno stato che non e' ne' aperto
// ne' chiuso (in attesa di pagamento, stati personalizzati) non si tocca.
const STATI_CHIUSI_WOO: Record<string, string> = { completed: 'spedito', cancelled: 'annullato', refunded: 'annullato', failed: 'annullato' }
const STATI_GIORNI = 60
const STATI_TEMPO_MAX_MS = 30000
const STATI_LETTURE_INSIEME = 2   // si somma alle letture dei pesi, sullo stesso negozio

async function allineaStatiWoo(db: any, integr: any, url: string, ck: string, cs: string, statiDaSpedire: Set<string>, inQuestaSync: Set<string>, finestraDa: string): Promise<number> {
  const scadenza = Date.now() + STATI_TEMPO_MAX_MS
  // Sessanta giorni di import, o di piu' se la sync guarda piu' indietro (Sincronizza su un periodo vecchio).
  const sessanta = new Date(Date.now() - STATI_GIORNI * 86400000).toISOString()
  const daQuando = finestraDa && finestraDa < sessanta ? finestraDa : sessanta
  const righe: { id: string; ordine_esterno_id: string; stato: string }[] = []
  for (let da = 0; ; da += 1000) {
    // Dai piu' recenti: se il tempo non basta per tutti, restano fuori i piu' vecchi, non sempre gli stessi a caso.
    const { data, error } = await db.from('ordini_ecommerce').select('id,ordine_esterno_id,stato')
      .eq('integrazione_id', integr.id).is('spedizione_id', null).in('stato', ['da_spedire', 'annullato'])
      .gte('created_at', daQuando).order('created_at', { ascending: false }).order('id').range(da, da + 999)
    if (error) throw new Error(error.message)
    righe.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  // Fuori: (1) gli ordini di questa stessa sync — il negozio li ha appena dati come da spedire, e la
  // scrittura che segue riscrive il loro stato di pagamento: un cambio fatto qui verrebbe smentito;
  // (2) i CAPOFILA di un'unione — nel pacco c'e' anche la merce degli ordini assorbiti, e chiudere il
  // capofila perche' il SUO ordine e' stato annullato la lascerebbe ferma senza che niente lo dica.
  const capofila = await capofilaDiUnioni(db, righe.map(r => r.id))
  const aperte = righe.filter(r => !inQuestaSync.has(String(r.ordine_esterno_id)) && !capofila.has(r.id))
  if (!aperte.length) return 0

  const sulNegozio = new Map<string, string>()
  const ids = aperte.map(r => String(r.ordine_esterno_id))
  const compiti: (() => Promise<void>)[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const blocco = ids.slice(i, i + 100)
    compiti.push(async () => {
      const rs = await wooGet(url, ck, cs, `/orders?include=${blocco.join(',')}&per_page=100&_fields=id,status`)
      for (const o of Array.isArray(rs) ? rs : []) if (o?.status) sulNegozio.set(String(o.id), String(o.status).toLowerCase())
    })
  }
  await inParallelo(compiti, STATI_LETTURE_INSIEME, scadenza, 'stati', integr.id)

  // Raggruppate per (stato di partenza → stato di arrivo, stato del negozio): poche scritture.
  const cambi = new Map<string, { da: string; a: string; statoNegozio: string; ids: string[] }>()
  for (const r of aperte) {
    const st = sulNegozio.get(String(r.ordine_esterno_id))
    if (!st) continue
    const a = STATI_CHIUSI_WOO[st] || (statiDaSpedire.has(st) ? 'da_spedire' : null)
    if (!a || a === r.stato) continue
    const k = `${r.stato}>${a}>${st}`
    if (!cambi.has(k)) cambi.set(k, { da: r.stato, a, statoNegozio: st, ids: [] })
    cambi.get(k)!.ids.push(String(r.ordine_esterno_id))
  }
  let annullati = 0
  for (const c of cambi.values()) {
    for (let i = 0; i < c.ids.length; i += 200) {
      // Le guardie stanno NELLA scrittura: mai una riga con la spedizione collegata, e solo se e'
      // ancora nello stato da cui si e' partiti (nel frattempo il cliente puo' averla spedita).
      const { data, error } = await db.from('ordini_ecommerce')
        .update({ stato: c.a, stato_pagamento: c.statoNegozio })
        .eq('integrazione_id', integr.id).is('spedizione_id', null).eq('stato', c.da)
        .in('ordine_esterno_id', c.ids.slice(i, i + 200)).select('id')
      if (error) throw new Error(error.message)
      if (c.a === 'annullato') annullati += (data || []).length
    }
  }
  return annullati
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

// L'unita' di peso cambia quasi mai: si ricorda per qualche ora, per istanza, invece di chiederla al
// negozio a ogni sync che ha un peso da leggere (su un negozio lento: cinque secondi ogni volta).
const unitaRicordata = new Map<string, { unita: string; quando: number }>()
const UNITA_VALIDA_MS = 6 * 3600 * 1000

async function unitaDiPeso(integr: any, url: string, ck: string, cs: string, ricordata: boolean): Promise<string> {
  // Dal tasto Sincronizza si rilegge sempre: chi lo preme puo' aver appena cambiato il negozio.
  const r = unitaRicordata.get(integr.id)
  if (ricordata && r && Date.now() - r.quando < UNITA_VALIDA_MS) return r.unita
  let unita = ''
  try { unita = String((await wooGet(url, ck, cs, '/settings/products/woocommerce_weight_unit', PESO_ATTESA_MS))?.value || '') } catch {}
  if (!unita) { try { unita = String((await wooGet(url, ck, cs, '/system_status?_fields=settings', PESO_ATTESA_MS))?.settings?.weight_unit || '') } catch {} }
  unita = unita.toLowerCase()
  if (GRAMMI_PER_UNITA[unita]) unitaRicordata.set(integr.id, { unita, quando: Date.now() })
  return unita
}

async function leggiPesiWoo(integr: any, url: string, ck: string, cs: string, ordini: any[], esistenti: Map<string, RigaEsistente>, frescoMs: number): Promise<Map<string, PesoArticolo>> {
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
  for (const [idOrdine, r] of esistenti) for (const a of r.articoli) {
    const letto = Date.parse(a?.peso_letto || '')
    if (!a?.prodotto_id || !Number.isFinite(letto)) continue
    const k = chiaveArticolo(a.prodotto_id, a.variante_id)
    if (!chiaviDi.get(idOrdine)?.has(k)) continue
    const gia = noti.get(k)
    if (!gia || Date.parse(gia.letto) < letto) noti.set(k, { grammi: Number(a.grammi) || 0, letto: a.peso_letto })
  }
  const oraMs = Date.now()
  for (const [k, p] of noti) if (oraMs - Date.parse(p.letto) < frescoMs) pesi.set(k, p)
  // PRIMA I MAI LETTI, poi il rinfresco di quelli noti: nel tempo massimo un negozio lento legge una
  // decina di prodotti, e un prodotto nuovo non deve aspettare che si rinfreschino gli altri.
  const mancanti = [...servono].filter(k => !pesi.has(k)).sort((x, y) => Number(noti.has(x)) - Number(noti.has(y)))
  // Cio' che non si e' riletto tiene il peso di prima, con la sua data: la prossima sync lo riprova.
  const conUltimiNoti = () => { for (const k of mancanti) if (!pesi.has(k) && noti.has(k)) pesi.set(k, noti.get(k)!); return pesi }
  if (!mancanti.length) return pesi

  const scadenza = Date.now() + PESO_TEMPO_MAX_MS
  const unita = await unitaDiPeso(integr, url, ck, cs, frescoMs >= UNITA_VALIDA_MS)
  const perUnita = GRAMMI_PER_UNITA[unita]
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
  await inParallelo(compiti, PESO_LETTURE_INSIEME, scadenza, 'pesi', integr.id)

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
