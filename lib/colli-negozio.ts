/* I COLLI CON CUI PARTE UN ORDINE DI UN NEGOZIO ONLINE (WooCommerce, Shopify, PrestaShop, eBay...).
 *
 * Il negozio dice cosa e' stato comprato (SKU e quantita'), non in quante scatole parte. Fino al
 * 20/11/2026 un ordine era SEMPRE un collo: peso sommato su tutti i pezzi, misure di un articolo.
 * Caso vero: azienda agricola Purita' Gaetano vende arance in cassette da 14,85 kg, ogni cassetta e'
 * una scatola. Un ordine di 2 cassette usciva come UN collo da 29,7 kg 39x30x29; uno di 16 cassette
 * come un collo da 237,6 kg, che nessun corriere prende: 20 ordini su 61 non si potevano spedire da
 * «Spedisci selezionati», e quelli sotto i 30 kg partivano con un'etichetta per piu' scatole.
 *
 * NON SI PUO' DIRE «ogni pezzo e' un collo» PER TUTTI: 14 clienti legano pacchi agli SKU e molti
 * negozi mettono piu' articoli nella stessa scatola. Lo dice il cliente, sul pacco salvato: la
 * casella «Un collo per ogni pezzo» (pacchi_predefiniti.un_collo_per_pezzo, decisione di Lorenzo
 * 20/11/2026). Ogni pezzo di quegli SKU e' un collo con le misure del pacco e il peso dell'articolo;
 * gli articoli senza la casella viaggiano insieme in un collo in piu', con la regola di prima.
 * Nessun articolo con la casella: l'ordine esce identico a prima, campo per campo. */

import { MISURE_RIPIEGO, type Collo } from '@/lib/colli-ordine'

export const chiaveSku = (s: unknown) => String(s || '').trim().toLowerCase()

// SKU -> articolo del catalogo (peso e misure).
export function mappaCatalogo(articoli: any[]): Map<string, any> {
  const m = new Map<string, any>()
  for (const a of articoli || []) { const k = chiaveSku(a?.sku); if (k) m.set(k, a) }
  return m
}

// SKU -> pacco salvato. Un pacco elenca piu' SKU separati da virgola, spazio o a capo.
export function mappaPacchi(pacchi: any[]): Map<string, any> {
  const m = new Map<string, any>()
  for (const p of pacchi || []) for (const s of String(p?.sku || '').split(/[\s,;]+/)) { const k = chiaveSku(s); if (k) m.set(k, p) }
  return m
}

export type PesoOrdine = {
  peso: number            // peso totale: la somma dei colli
  l: number; w: number; h: number   // misure del primo collo
  pesoStimato: boolean    // nessun peso da nessuna parte: si spedisce su 1 kg (a collo)
  senzaPeso: number       // righe d'ordine rimaste senza peso (il peso e' per difetto)
  colli: Collo[]
}

// Peso del pezzo: il catalogo vince, poi il peso letto dal negozio (grammi). Decisione di Lorenzo
// 19/10/2026: il catalogo vince sul negozio.
function pesoUnitario(a: any, skuToArt: Map<string, any>): number {
  const k = chiaveSku(a?.sku)
  const cat = k ? skuToArt.get(k) : null
  if (cat && Number(cat.peso) > 0) return Number(cat.peso)
  return Number(a?.grammi) > 0 ? Number(a.grammi) / 1000 : 0
}

// LA REGOLA DI PRIMA, invariata: tutti gli articoli in un collo. Il peso e' la somma riga per riga e
// pezzo per pezzo; il pacco dello SKU del primo articolo da' le misure, e il suo peso conta solo se
// nessun articolo ne ha uno. Somma incompleta: mai sotto il chilo di ripiego (150 g noti piu' un
// articolo senza peso non sono un pacco da 150 g).
function unCollo(arts: any[], skuToArt: Map<string, any>, skuToPacco: Map<string, any>) {
  const sku0 = chiaveSku(arts[0]?.sku)
  const art = sku0 ? skuToArt.get(sku0) : null
  const pacco = sku0 ? skuToPacco.get(sku0) : null
  let peso = 0, senzaPeso = 0
  for (const a of arts) {
    const unitario = pesoUnitario(a, skuToArt)
    if (unitario > 0) peso += unitario * (Number(a?.quantita) || 1); else senzaPeso++
  }
  peso = Math.round(peso * 1000) / 1000
  if (!(peso > 0) && pacco && Number(pacco.peso) > 0) { peso = Number(pacco.peso); senzaPeso = 0 }
  if (senzaPeso > 0 && peso > 0 && peso < 1) peso = 1
  const pesoStimato = !(peso > 0)
  if (pesoStimato) peso = 1
  const box = pacco ? { l: pacco.lunghezza, w: pacco.larghezza, h: pacco.altezza }
    : (art && (Number(art.lunghezza) || Number(art.larghezza) || Number(art.altezza))) ? { l: art.lunghezza, w: art.larghezza, h: art.altezza }
    : { l: MISURE_RIPIEGO.length, w: MISURE_RIPIEGO.width, h: MISURE_RIPIEGO.height }
  return {
    peso: Math.max(0.01, peso),
    l: Number(box.l) || MISURE_RIPIEGO.length, w: Number(box.w) || MISURE_RIPIEGO.width, h: Number(box.h) || MISURE_RIPIEGO.height,
    pesoStimato, senzaPeso: pesoStimato ? 0 : senzaPeso,
  }
}

export function colliOrdineNegozio(articoli: unknown, skuToArt: Map<string, any>, skuToPacco: Map<string, any>): PesoOrdine {
  const arts: any[] = Array.isArray(articoli) ? articoli : []
  const propri: Collo[] = []
  const insieme: any[] = []
  let senzaPesoPropri = 0, pesoNotoPropri = false
  for (const a of arts) {
    const k = chiaveSku(a?.sku)
    const pacco = k ? skuToPacco.get(k) : null
    if (!pacco?.un_collo_per_pezzo) { insieme.push(a); continue }
    // Il peso del pezzo; se ne' catalogo ne' negozio lo sanno, quello del pacco (e' la cassetta piena).
    let unitario = pesoUnitario(a, skuToArt)
    if (!(unitario > 0) && Number(pacco.peso) > 0) unitario = Number(pacco.peso)
    if (unitario > 0) pesoNotoPropri = true; else { unitario = 1; senzaPesoPropri++ }
    // I pezzi sono scatole: si contano interi. Una quantita' strana (0, vuota, non numerica) e' un pezzo.
    const pezzi = Math.max(1, Math.round(Number(a?.quantita) || 1))
    const misure = {
      length: Number(pacco.lunghezza) || MISURE_RIPIEGO.length,
      width: Number(pacco.larghezza) || MISURE_RIPIEGO.width,
      height: Number(pacco.altezza) || MISURE_RIPIEGO.height,
    }
    for (let i = 0; i < pezzi; i++) propri.push({ weight: Math.max(0.01, unitario), ...misure })
  }

  // Nessun pezzo con la casella: la regola di prima, identica.
  if (!propri.length) {
    const u = unCollo(arts, skuToArt, skuToPacco)
    return { ...u, colli: [{ length: u.l, width: u.w, height: u.h, weight: u.peso }] }
  }

  const colli = [...propri]
  let senzaPeso = senzaPesoPropri, pesoNoto = pesoNotoPropri
  if (insieme.length) {
    const u = unCollo(insieme, skuToArt, skuToPacco)
    colli.push({ length: u.l, width: u.w, height: u.h, weight: u.peso })
    // Collo degli altri articoli tutto senza peso: e' sul chilo di ripiego, e va detto. Caso vero,
    // Purita' #17952: 15 cassette di arance piu' «Limoni siciliani - 14 Kg.», che sul negozio non ha
    // ne' SKU ne' peso. Il collo c'e' (e' una cassetta), il suo peso no: la riga deve avvisare.
    senzaPeso += u.pesoStimato ? insieme.length : u.senzaPeso
    if (!u.pesoStimato) pesoNoto = true
  }
  let peso = 0
  for (const c of colli) peso += c.weight
  peso = Math.round(peso * 1000) / 1000
  // LA SOMMA DEI COLLI NON DEVE SUPERARE IL PESO DELL'ORDINE. Il motore somma i colli senza
  // arrotondare (lib/pricing.ts, calcolaPesoFatturato) e confronta con le fasce: in virgola mobile
  // sedici cassette da 14,85 kg possono fare 237,60000000000002, e su un limite di fascia si salirebbe
  // alla fascia dopo per un niente. Stessa cura dell'import da file (lib/colli-ordine.ts): l'eccedenza
  // si toglie dall'ultimo collo, sommando nello stesso ordine del motore.
  for (let giro = 0; giro < 4; giro++) {
    let somma = 0
    for (const c of colli) somma += c.weight
    if (somma <= peso) break
    colli[colli.length - 1].weight -= somma - peso
  }
  return {
    peso, l: colli[0].length, w: colli[0].width, h: colli[0].height,
    pesoStimato: !pesoNoto, senzaPeso: pesoNoto ? senzaPeso : 0,
    colli,
  }
}
