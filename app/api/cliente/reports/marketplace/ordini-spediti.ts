import { fetchAllStretto } from '@/lib/fetch-all'
import { leggiPerBlocchi } from '../comune'

// Riconosce la piattaforma di provenienza dell'ordine importato dalla riga originale (raw).
export function piattaformaDa(raw: any): 'amazon' | 'shopify' | 'temu' | 'altro' {
  if (!raw || typeof raw !== 'object') return 'altro'
  // Temu PRIMA: il suo export ha colonne inequivocabili (Sconto di Temu, la email "virtuale" di
  // relay, l'ID articolo dell'ordine). Va riconosciuto, se no gli ordini Temu finiscono in "altro"
  // e non escono quando si scarica il tracking per piattaforma.
  if ('sconto_di_temu' in raw || 'email_virtuale' in raw || 'id_articolo_dellordine' in raw) return 'temu'
  if ('orderitemid' in raw || 'order_item_id' in raw || 'amazonorderid' in raw) return 'amazon'
  if ('lineitem_name' in raw || 'financial_status' in raw || 'shipping_name' in raw || 'shipping_zip' in raw) return 'shopify'
  return 'altro'
}

export const ANNULLATI = ['annullata', 'annullamento_pending', 'annullamento_manuale']

const rifDi = (o: any) => o.order_id || o.raw?.amazonorderid || o.raw?.amazon_order_id || o.raw?.orderid || null

// Recupera gli ordini importati DA FILE che NON risultano spediti (restano 'da_spedire'/'errore',
// senza spedizione_id) ma il cui PACCO È GIÀ PARTITO: il cliente ha creato la spedizione a mano da
// "Nuova Spedizione" mettendo il codice ordine nel riferimento, POI ha importato il file del
// marketplace → la riga importata non si è mai agganciata alla spedizione e sparisce dal report anche
// se spedita (spesso già consegnata). Li riaggancio per rif_ordine = ordine, così tornano nel report
// e nel file di conferma. (Causa dei "dopo aver spedito non trovo tutti gli ordini nel report".)
// Perché lo stato è rimasto indietro: quel pacco è nato da un'ALTRA porta (Nuova Spedizione), non
// dalla lista ordini, quindi lo stato dell'ordine importato non è mai passato a 'spedito'.
// Finestra 120gg: una conferma più vecchia è fuori dai tempi utili di Amazon, e non vale il costo di
// scandagliare backlog enormi di 'da spedire' MAI spediti (clienti con migliaia di righe). Due sole
// query (ordini + spedizioni del cliente) con aggancio in memoria: niente .in() a blocchi sui rif.
async function ordiniSpeditiPerRiferimento(supabase: any, clienteId: string, campiOrdine: string, spedSelect: string) {
  const DA = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString()
  const orfani = await fetchAllStretto<any>(() => supabase
    .from('ordini_importati')
    .select(campiOrdine)
    .eq('cliente_id', clienteId)
    .in('stato', ['da_spedire', 'errore'])
    .is('integrazione_id', null)
    .is('spedizione_id', null)
    .gte('created_at', DA)
    .order('id', { ascending: true }))
  const conRif = orfani.map((o: any) => ({ o, rif: rifDi(o) })).filter((x: any) => x.rif)
  if (!conRif.length) return []

  // Tutte le spedizioni valide del cliente (120gg) con un riferimento: UNA lettura, poi aggancio in
  // memoria per rif_ordine. Ordinate desc → per ogni rif tengo la spedizione più recente.
  const speds = await fetchAllStretto<any>(() => supabase
    .from('spedizioni')
    .select(spedSelect + ', rif_ordine')
    .eq('cliente_id', clienteId)
    .not('rif_ordine', 'is', null)
    .is('cancellata_il', null)
    .gte('created_at', DA)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false }))
  const spedDiRif = new Map<string, any>()
  for (const s of speds) {
    if (ANNULLATI.includes(String(s.stato || ''))) continue
    const rif = s.rif_ordine
    if (rif && !spedDiRif.has(rif)) spedDiRif.set(rif, s)
  }

  // Aggancio + dedup per riferimento: non confermare due volte lo stesso ordine col medesimo tracking.
  const visti = new Set<string>()
  const out: any[] = []
  for (const { o, rif } of conRif) {
    if (visti.has(rif as string)) continue
    const sp = spedDiRif.get(rif as string)
    if (!sp) continue
    visti.add(rif as string)
    out.push({ ...o, spedizioni: sp })
  }
  return out
}

// TUTTI gli ordini importati DA FILE (non dai negozi collegati) e spediti, ognuno con la sua
// spedizione: quelli agganciati ('spedito'), quelli UNITI nel capofila e quelli spediti "per
// riferimento". Lo usano sia il report a video sia il file da scaricare, cosi' i numeri coincidono.
// `spedSelect` deve contenere `id`: serve a togliere i doppioni.
//
// UNA SPEDIZIONE GIA' LEGATA A UN ORDINE NON SI RIAGGANCIA. Lo stesso ordine importato piu' volte
// lascia copie 'da_spedire' senza spedizione, e l'aggancio per riferimento le ripescava sulla
// spedizione gia' legata alla riga 'spedito': TIMELESS LADY contava 1.134 ordini invece di 1.000
// (l'ordine Shopify #6258, importato 3 volte, sulla 1UW07WF287797) e li metteva due volte nel file da
// ricaricare. In piu' 12 spedizioni avevano due righe 'spedito' dello STESSO ordine. Al 15/10/2026,
// su 192 clienti, 11 avevano numeri gonfiati da questi doppioni (196 ordini contati in piu').
// Il doppione si riconosce DENTRO la stessa piattaforma: se un cliente ha spedito da un file generico
// e poi ha importato il file Amazon, la copia Amazon e' l'unica che puo' finire nel file di conferma
// di Amazon e va tenuta (RASPADA: 5 ordini, CANNAVA' FORNITURE: 6). Gli ordini UNITI, che hanno numeri
// d'ordine diversi sulla spedizione del capofila, restano tutti: vanno confermati tutti.
export async function ordiniSpediti(supabase: any, clienteId: string, spedSelect: string) {
  const CAMPI = 'id, order_id, contenuto, colli, raw, articoli'
  // Tiebreaker su id: oltre le 1000 righe la paginazione senza chiave univoca puo' duplicare o
  // perdere ordini (righe con lo stesso created_at).
  const diretti = await fetchAllStretto<any>(() => supabase
    .from('ordini_importati')
    .select(`${CAMPI}, spedizioni!inner(${spedSelect})`)
    .eq('cliente_id', clienteId)
    .eq('stato', 'spedito')
    .is('integrazione_id', null)                 // solo ordini caricati da FILE (non dai negozi collegati)
    .not('spedizione_id', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true }))

  // ORDINI "UNITI" (accoppiati nel capofila con "Unisci"): non hanno spedizione propria
  // (spedizione_id null, stato 'unito'), ma vanno confermati al marketplace con il tracking del
  // CAPOFILA — altrimenti restano "non spediti" su Amazon anche se il pacco è partito col capo, e il
  // cliente prende metriche a rischio / reclami su ordini in realtà evasi. Il puntatore è `unito_in`
  // (vedi /api/ordini/unisci). Uso i dati dell'ordine unito (order-id, articoli) + la spedizione del capo.
  const uniti = await fetchAllStretto<any>(() => supabase
    .from('ordini_importati')
    .select(`${CAMPI}, unito_in`)
    .eq('cliente_id', clienteId)
    .eq('stato', 'unito')
    .is('integrazione_id', null)
    .not('unito_in', 'is', null)
    .order('id', { ascending: true }))
  const capoIds = Array.from(new Set(uniti.map((u: any) => u.unito_in).filter(Boolean))) as string[]
  const spedDiCapo = new Map<string, any>()
  const capi = await leggiPerBlocchi<any>(capoIds, (b) => supabase.from('ordini_importati')
    .select(`id, spedizioni(${spedSelect})`).in('id', b).order('id', { ascending: true }))
  for (const c of capi) if (c.spedizioni) spedDiCapo.set(c.id, c.spedizioni)
  const unitiConSped = uniti
    .map((u: any) => ({ ...u, spedizioni: spedDiCapo.get(u.unito_in) }))
    .filter((u: any) => u.spedizioni)   // solo se il capofila ha davvero una spedizione

  const orfani = await ordiniSpeditiPerRiferimento(supabase, clienteId, CAMPI, spedSelect)

  const visti = new Set<string>()      // stesso ordine sulla stessa spedizione
  const legate = new Set<string>()     // piattaforma|spedizione gia' legata a un ordine
  const out: any[] = []
  for (const r of [...diretti, ...unitiConSped]) {
    const spId = r.spedizioni?.id
    const k = `${spId}|${rifDi(r) || r.id}`
    if (visti.has(k)) continue
    visti.add(k); if (spId) legate.add(`${piattaformaDa(r.raw)}|${spId}`)
    out.push(r)
  }
  for (const o of orfani) {
    const spId = o.spedizioni?.id
    const k = `${piattaformaDa(o.raw)}|${spId}`
    if (!spId || legate.has(k)) continue
    legate.add(k)
    out.push(o)
  }
  return out
}
