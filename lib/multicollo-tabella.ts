// TABELLA MULTICOLLO — il prezzo di una spedizione a piu' colli quando il fornitore NON la prezza come
// un pacco solo.
//
// Perche' esiste. UPS Europa (via fornitore) prezza il multicollo cosi', verificato l'11/11/2026 su
// ~3.000 preventivi e su 40 spedizioni inventate a caso (32 esatte al centesimo, le altre entro 2):
//
//   prezzo = il piu' alto fra   7,848 € x colli
//                          e   tariffa dell'AREA sul PESO TOTALE + localita' remota + partenza remota
//
// - la tariffa sul totale NON e' quella del collo singolo (Bucarest: 2 colli da 3 kg 24,49, un collo da
//   6 kg 17,80) e cambia per AREA, non per la zona del collo singolo (Amsterdam e Madrid, stessa zona:
//   2x10 kg 16,31 contro 15,70);
// - il peso si conta collo per collo come fa UPS: misure al centimetro in su, volume / divisore, il piu'
//   alto fra peso e volume arrotondato a mezzo chilo in su, poi la somma;
// - localita' remota e partenza remota crescono col peso: "minimo, oppure tot al kg se di piu'"
//   (DAS 7,94 o 0,1613/kg, EDAS 9,52 o 0,1945/kg, partenza 1,74 o 0,0593/kg), e si sommano alla tariffa,
//   NON al minimo per collo.
// Con la sola regola "minimo x colli oppure fascia del collo singolo sul totale" MULTIEXPRESS pagava
// 18,85 un pacco Caulonia->Madrid da 15+8,8 kg che il fornitore fa 15,70, e 18,85 un Bucarest 3+3 kg che
// il fornitore fa 24,49 (sotto: chi compra da MULTI lo pagava meno di quanto costa).
//
// Dove sta.
// - Le AREE (la geografia del fornitore) stanno sul contratto del DETENTORE, settings.multicollo_aree:
//     { "DE": { "*": "A", "66-97": "DESUD" }, "FR": { "*": "A", "01": "FRSE", ... }, "NL": { "*": "NL" }, ... }
//   chiave = paese; dentro, "*" = tutto il paese, "NN" = codici che iniziano per NN, "NN-MM" = da NN a MM
//   (prime cifre del codice postale, quante ne ha la chiave). Il prefisso piu' lungo vince sul "*".
//   settings.multicollo_aree_nomi = { "A": "Europa A (…)", … } per le intestazioni delle colonne.
// - I PREZZI stanno in ogni listino (corriere e cliente) come supplemento tipo 'multicollo_tabella' del
//   contratto, con la tabella in `descrizione` (JSON, come le giacenze):
//     { "fasce": [5,10,…,200], "aree": { "A": [7.55, …], … },
//       "oltre":    { "A": 0.20816, … },   // € al kg oltre l'ultima fascia, sui kg TOTALI arrotondati all'unita' in su
//       "remota":   { "<nome zona remota>":  { "minimo": 7.94, "kg": 0.1613 } },
//       "partenza": { "<nome zona mittente>": { "minimo": 1.74, "kg": 0.0593 } } }
//   Oltre i 200 kg il fornitore non va piu' a fasce: 0,6024 €/kg x kg per la Romania (300 kg 180,72,
//   800 kg 481,92), e 200,5 kg si paga come 201.
//   Le zone remote e di partenza si riconoscono per NOME (sono le zone del contratto che il listino gia'
//   usa): cosi' la tabella scende ai sotto-master con la copia dei supplementi senza rimappare id.
// - Il minimo per collo resta la voce 'minimo_collo' (vedi lib/pricing → noloMulticollo).
//
// Senza tabella nel listino, o senza aree sul contratto, NON cambia niente: vale la regola di prima.
// Un collo solo non passa mai di qui.

export const TIPO_MULTICOLLO_TABELLA = 'multicollo_tabella'

export type SupplementoAlKg = { minimo: number; kg: number }
export type TabellaMulticollo = {
  fasce: number[]
  aree: Record<string, (number | null)[]>
  oltre: Record<string, number>
  remota: Record<string, SupplementoAlKg>
  partenza: Record<string, SupplementoAlKg>
}
export type AreeMulticollo = Record<string, Record<string, string>>

const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
const r2 = (n: number) => Math.round(n * 100) / 100

// La tabella di un elenco di supplementi (gia' filtrato per listino e contratto). null = non c'e', o non
// si legge: in quel caso si comporta come prima (mai un prezzo inventato da una tabella rotta).
export function leggiTabellaMulticollo(suppl: any[]): TabellaMulticollo | null {
  const riga = (suppl || []).find((s: any) => s?.tipo === TIPO_MULTICOLLO_TABELLA)
  if (!riga) return null
  let d: any = null
  try { d = typeof riga.descrizione === 'string' ? JSON.parse(riga.descrizione) : riga.descrizione } catch { return null }
  return normalizzaTabella(d)
}

// Una tabella valida: fasce crescenti, ogni area con un prezzo per fascia (null = non venduta).
export function normalizzaTabella(d: any): TabellaMulticollo | null {
  if (!d || !Array.isArray(d.fasce) || !d.fasce.length || typeof d.aree !== 'object' || !d.aree) return null
  const fasce = d.fasce.map((x: any) => Number(x))
  if (fasce.some((x: number, i: number) => !(x > 0) || (i > 0 && x <= fasce[i - 1]))) return null
  const aree: Record<string, (number | null)[]> = {}
  for (const [k, v] of Object.entries<any>(d.aree)) {
    if (!Array.isArray(v)) continue
    aree[String(k)] = fasce.map((_: number, i: number) => num(v[i]))
  }
  const alKg = (o: any): Record<string, SupplementoAlKg> => {
    const out: Record<string, SupplementoAlKg> = {}
    for (const [k, v] of Object.entries<any>(o || {})) {
      const minimo = Number(v?.minimo) || 0, kg = Number(v?.kg) || 0
      if (minimo > 0 || kg > 0) out[String(k)] = { minimo, kg }
    }
    return out
  }
  const oltre: Record<string, number> = {}
  for (const [k, v] of Object.entries<any>(d.oltre || {})) { const n = num(v); if (n) oltre[String(k)] = n }
  return { fasce, aree, oltre, remota: alKg(d.remota), partenza: alKg(d.partenza) }
}

// Le aree del contratto (settings del detentore). null = il contratto non ha la tabella multicollo.
export function leggiAreeMulticollo(settings: any): AreeMulticollo | null {
  const a = settings?.multicollo_aree
  if (!a || typeof a !== 'object') return null
  const out: AreeMulticollo = {}
  for (const [paese, regole] of Object.entries<any>(a)) {
    if (!regole || typeof regole !== 'object') continue
    out[String(paese).toUpperCase().trim()] = Object.fromEntries(Object.entries<any>(regole).map(([k, v]) => [String(k).trim(), String(v)]))
  }
  return Object.keys(out).length ? out : null
}

// Le COLONNE della tabella (le aree, nell'ordine e coi nomi scritti sul contratto del detentore): servono
// agli editor e alle viste del listino. Nessun nome di fornitore: solo paesi e codici postali.
export type ColonnaMulticollo = { key: string; nome: string }
export function colonneMulticollo(settings: any): ColonnaMulticollo[] {
  const aree = leggiAreeMulticollo(settings)
  if (!aree) return []
  const usate = new Set<string>()
  for (const regole of Object.values(aree)) for (const a of Object.values(regole)) if (a) usate.add(a)
  const ordine: string[] = Array.isArray(settings?.multicollo_aree_ordine) ? settings.multicollo_aree_ordine.map(String) : []
  const chiavi = [...ordine.filter(k => usate.has(k)), ...Array.from(usate).filter(k => !ordine.includes(k)).sort()]
  const nomi = settings?.multicollo_aree_nomi || {}
  return chiavi.map(k => ({ key: k, nome: String(nomi[k] || k) }))
}

// Le colonne per un contratto qualsiasi della catena: le aree stanno sul contratto del DETENTORE
// (contratto_id). Client di servizio: il detentore e' di un altro master. Si leggono solo contratto_id e
// settings, mai le credenziali.
export async function colonneDelContratto(admin: any, corriereId: string | null | undefined): Promise<ColonnaMulticollo[]> {
  if (!corriereId) return []
  const { data: c } = await admin.from('corrieri').select('id,contratto_id').eq('id', corriereId).maybeSingle()
  const det = c?.contratto_id || c?.id
  if (!det) return []
  const { data: d } = await admin.from('corrieri').select('settings').eq('id', det).maybeSingle()
  return colonneMulticollo(d?.settings)
}

// L'area di una destinazione. Le cifre del codice postale (lettere e spazi tolti: "LV-1050" → 1050,
// "411 05" → 41105). Il prefisso piu' lungo che combacia vince; "*" se nessun prefisso.
export function areaMulticollo(aree: AreeMulticollo | null, paese: string | undefined, cap: string | undefined): string | null {
  if (!aree) return null
  const regole = aree[String(paese || 'IT').toUpperCase().trim()]
  if (!regole) return null
  const cifre = String(cap || '').replace(/\D/g, '')
  let migliore: { lung: number; area: string } | null = null
  for (const [chiave, area] of Object.entries(regole)) {
    if (chiave === '*') continue
    const m = /^(\d+)(?:-(\d+))?$/.exec(chiave)
    if (!m) continue
    const lung = m[1].length
    if (cifre.length < lung) continue
    const pref = Number(cifre.slice(0, lung)), da = Number(m[1]), a = m[2] !== undefined ? Number(m[2]) : da
    if (pref >= da && pref <= a && (!migliore || lung > migliore.lung)) migliore = { lung, area }
  }
  return migliore ? migliore.area : (regole['*'] ?? null)
}

// Il peso come lo conta il fornitore: per ogni collo misure al centimetro in su, volume / divisore,
// il piu' alto fra peso e volume, arrotondato a mezzo chilo in su; poi la somma.
// Verificato: 15,1+15,1 kg = 31 (non 30,2); un collo 100x50x15,3 cm = 16 kg di volume (non 15,3);
// 100x45x45 = 40,5 (resta 40,5); 15 kg piccolo + 1 kg 100x50x25 = 40 (non 25,2).
export function pesoMulticolloFornitore(packages: any[], divisore: number): number {
  const d = divisore > 0 ? divisore : 5000
  let tot = 0
  for (const p of packages || []) {
    const kg = Number(p?.weight ?? p?.peso) || 0
    const l = Math.ceil((Number(p?.length ?? p?.lunghezza) || 0) - 1e-9)
    const w = Math.ceil((Number(p?.width ?? p?.larghezza) || 0) - 1e-9)
    const h = Math.ceil((Number(p?.height ?? p?.altezza) || 0) - 1e-9)
    const vol = l > 0 && w > 0 && h > 0 ? (l * w * h) / d : 0
    tot += Math.ceil(Math.max(kg, vol) * 2 - 1e-9) / 2
  }
  return Math.round(tot * 2) / 2
}

const alKg = (s: SupplementoAlKg | undefined, T: number) => (s ? Math.max(s.minimo, s.kg * T) : 0)

// LE CASELLE VENDUTE SOTTO COSTO di una tabella di vendita rispetto alla tabella del costo. Una casella
// vuota dove il costo c'e' NON e' sotto costo: li' il multicollo semplicemente non si vende. Le fasce
// si confrontano per peso, non per posizione (chi vende puo' averne messe di diverse): per ogni fascia di
// vendita il costo e' quello della fascia di costo in cui cade il suo limite. Stessa funzione per l'editor
// e per il Check sotto costo.
export function caselleSottoCosto(vendita: TabellaMulticollo | null, costo: TabellaMulticollo | null): string[] {
  if (!vendita || !costo) return []
  const out: string[] = []
  const costoA = (area: string, kg: number): number | null => {
    const i = costo.fasce.findIndex(f => kg <= f + 1e-9)
    if (i >= 0) return costo.aree[area]?.[i] ?? null
    const k = costo.oltre[area]; return k ? k * Math.ceil(kg - 1e-9) : null
  }
  for (const [area, prezzi] of Object.entries(vendita.aree)) {
    vendita.fasce.forEach((kg, i) => {
      const v = prezzi[i], c = costoA(area, kg)
      if (v != null && c != null && v < c - 0.005) out.push(`${area}|${kg}`)
    })
    const vo = vendita.oltre[area], co = costo.oltre[area]
    if (vo && co && vo < co - 0.000005) out.push(`${area}|oltre`)
  }
  for (const tipo of ['remota', 'partenza'] as const) {
    for (const [zona, c] of Object.entries(costo[tipo])) {
      const v = vendita[tipo][zona]
      // Remota/partenza senza prezzo in vendita, ma col costo: si vende a prezzo di pianura → sotto costo.
      if (!v || v.minimo < c.minimo - 0.005 || v.kg < c.kg - 0.000005) out.push(`${tipo}|${zona}`)
    }
  }
  return out
}

// "Copia dal costo + ricarico": prezzi = costo x (1 + perc/100) + euro. Euro solo sulle caselle a prezzo
// fisso per spedizione; il prezzo al kg e i supplementi prendono solo la percentuale (un euro fisso su
// ogni kg, o sommato anche alla remota, sarebbe un ricarico diverso da quello scritto).
export function tabellaDalCosto(costo: TabellaMulticollo, perc: number, euro: number): TabellaMulticollo {
  const p = 1 + (Number(perc) || 0) / 100, e = Number(euro) || 0
  const r = (x: number, dec = 2) => Math.round(x * 10 ** dec) / 10 ** dec
  const aree: Record<string, (number | null)[]> = {}
  for (const [a, v] of Object.entries(costo.aree)) aree[a] = v.map(x => (x == null ? null : r(x * p + e)))
  const oltre: Record<string, number> = {}
  for (const [a, v] of Object.entries(costo.oltre)) oltre[a] = r(v * p, 5)
  const sup = (o: Record<string, SupplementoAlKg>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { minimo: r(v.minimo * p), kg: r(v.kg * p, 5) }]))
  return { fasce: [...costo.fasce], aree, oltre, remota: sup(costo.remota), partenza: sup(costo.partenza) }
}

export type EsitoTabella = { nolo: number; area: string; fasciaFinoA: number; pesoTotale: number; remota: number; partenza: number; minimo: number }

// Il nolo del multicollo dalla tabella. null = su questo livello quella spedizione NON si vende con la
// tabella (area non prevista, peso oltre l'ultima fascia, casella vuota, partenza remota non prezzata):
// il chiamante esclude il contratto, come per ogni altra destinazione senza prezzo.
//   zonaDest: nome della zona di destinazione che il listino ha agganciato (per la localita' remota)
//   zonaMitt: nome della zona di partenza agganciata dal mittente, se c'e' (null = partenza normale)
export function noloDaTabella(p: {
  tabella: TabellaMulticollo; aree: AreeMulticollo; paese?: string; cap?: string
  packages: any[]; divisore: number; minimoCollo: number; zonaDest?: string | null; zonaMitt?: string | null
}): EsitoTabella | null {
  const colli = (p.packages || []).length
  if (colli < 2) return null
  const area = areaMulticollo(p.aree, p.paese, p.cap)
  if (!area || !p.tabella.aree[area]) return null
  const T = pesoMulticolloFornitore(p.packages, p.divisore)
  const i = p.tabella.fasce.findIndex(f => T <= f + 1e-9)
  let base: number | null
  let fasciaFinoA: number
  if (i >= 0) { base = p.tabella.aree[area][i]; fasciaFinoA = p.tabella.fasce[i] }
  else {
    // Oltre l'ultima fascia: € al kg sui kg totali arrotondati all'unita' in su (200,5 → 201).
    const alKgArea = p.tabella.oltre[area]
    base = alKgArea ? alKgArea * Math.ceil(T - 1e-9) : null
    fasciaFinoA = Math.ceil(T - 1e-9)
  }
  if (base == null) return null
  const remota = alKg(p.zonaDest ? p.tabella.remota[p.zonaDest] : undefined, T)
  let partenza = 0
  if (p.zonaMitt) {
    const s = p.tabella.partenza[p.zonaMitt]
    if (!s) return null   // partenza remota senza prezzo in tabella: non si vende ("non hai il prezzo, non vendi")
    partenza = alKg(s, T)
  }
  const minimo = p.minimoCollo > 0 ? r2(colli * p.minimoCollo) : 0
  return { nolo: Math.max(minimo, r2(base + remota + partenza)), area, fasciaFinoA, pesoTotale: T, remota: r2(remota), partenza: r2(partenza), minimo }
}
