// MULTICOLLO A ZONE — il prezzo di una spedizione a piu' colli quando il fornitore NON la prezza come un
// pacco solo.
//
// Perche' esiste. UPS Europa (via fornitore) prezza il multicollo cosi', verificato l'11/11/2026 su
// ~3.000 preventivi e su 789 spedizioni prezzate dal fornitore (625 esatte al centesimo, le altre entro 2):
//
//   prezzo = il piu' alto fra   7,848 € x colli
//                          e   tariffa della ZONA MULTICOLLO sul PESO TOTALE + localita' remota + partenza remota
//
// - la tariffa sul totale NON e' quella del collo singolo (Bucarest: 2 colli da 3 kg 24,49, un collo da
//   6 kg 17,80) e le sue zone non sono quelle del collo singolo (Amsterdam e Madrid, stessa zona del
//   collo singolo: 2x10 kg 16,31 contro 15,70; Germania sud e Francia sud-est per codice postale);
// - il peso si conta collo per collo come fa UPS: misure al centimetro in su, volume / divisore, il piu'
//   alto fra peso e volume arrotondato a mezzo chilo in su, poi la somma;
// - localita' remota e partenza remota crescono col peso: "minimo, oppure tot al kg se di piu'"
//   (DAS 7,94 o 0,1613/kg, EDAS 9,53 o 0,1945/kg, partenza 1,74 o 0,0593/kg), e si sommano alla tariffa,
//   NON al minimo per collo.
// Con "minimo x colli oppure la fascia del collo singolo sul totale" MULTIEXPRESS pagava 18,85 un
// Caulonia->Madrid 15+8,8 kg che il fornitore fa 15,70, e 18,85 un Bucarest 3+3 kg che fa 24,49.
//
// Dove sta (come per gli altri corrieri, con le stesse pagine):
// - le ZONE MULTICOLLO sono zone del contratto col segno `zone.multicollo` (Gestione Zone). Le righe
//   paese/CAP si scrivono come le altre; qui un CAP piu' corto del codice di destinazione vale come
//   PREFISSO ("DE / 66" = tutti i codici tedeschi che iniziano per 66). Il collo singolo non le vede mai;
// - le FASCE MULTICOLLO sono fasce normali del listino su quelle zone (scheda Multicollo, stessa griglia
//   di Pesi / Zone): "fino a X kg" sul peso totale, "oltre X ogni Y" oltre l'ultima;
// - il MINIMO PER COLLO e' la voce 'minimo_collo' (lib/pricing → noloMulticollo);
// - LOCALITA' REMOTA e PARTENZA REMOTA sono il supplemento 'multicollo_supplementi' (JSON in descrizione,
//   come le giacenze): { "remota": { "<zona del collo singolo>": { "minimo": 7.94, "kg": 0.1613 } },
//   "partenza": { "<zona di partenza>": { "minimo": 1.74, "kg": 0.0593 } } }. La destinazione remota la
//   riconosce la stessa zona del collo singolo (un elenco solo di localita' remote per i due casi).
//
// Senza fasce multicollo nel listino non cambia niente: vale la regola di prima. Un collo solo non passa
// mai di qui.

export const TIPO_MULTICOLLO_SUPPLEMENTI = 'multicollo_supplementi'

export type SupplementoAlKg = { minimo: number; kg: number }
export type SupplementiMulticollo = { remota: Record<string, SupplementoAlKg>; partenza: Record<string, SupplementoAlKg> }

const r2 = (n: number) => Math.round(n * 100) / 100

export function normalizzaSupplementiMulticollo(d: any): SupplementiMulticollo | null {
  if (!d || typeof d !== 'object') return null
  const alKg = (o: any): Record<string, SupplementoAlKg> => {
    const out: Record<string, SupplementoAlKg> = {}
    for (const [k, v] of Object.entries<any>(o || {})) {
      const minimo = Number(v?.minimo) || 0, kg = Number(v?.kg) || 0
      if (String(k).trim() && (minimo > 0 || kg > 0)) out[String(k).trim()] = { minimo, kg }
    }
    return out
  }
  const s = { remota: alKg(d.remota), partenza: alKg(d.partenza) }
  return Object.keys(s.remota).length || Object.keys(s.partenza).length ? s : null
}

// Il supplemento in un elenco di righe (gia' filtrato per listino e contratto). null = non c'e'.
export function leggiSupplementiMulticollo(suppl: any[]): SupplementiMulticollo | null {
  const riga = (suppl || []).find((s: any) => s?.tipo === TIPO_MULTICOLLO_SUPPLEMENTI)
  if (!riga) return null
  try { return normalizzaSupplementiMulticollo(typeof riga.descrizione === 'string' ? JSON.parse(riga.descrizione) : riga.descrizione) } catch { return null }
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

// LA ZONA MULTICOLLO di una destinazione, fra le righe (zona_id, paese, cap) delle zone multicollo del
// contratto. CAP uguale > PREFISSO piu' lungo (una riga piu' corta del codice: "66" per 66xxx) > "*".
// Si confrontano le sole cifre ("LV-1050" → 1050, "411 05" → 41105). null = nessuna zona.
export function zonaMulticolloDi(righe: { zona_id: string; paese?: string | null; cap?: string | null }[], paese: string | undefined, cap: string | undefined): string | null {
  const p = String(paese || 'IT').toUpperCase().trim()
  const cifre = String(cap || '').replace(/\D/g, '')
  let migliore: { forza: number; zona: string } | null = null
  for (const r of righe || []) {
    if (String(r.paese || 'IT').toUpperCase().trim() !== p) continue
    const c = String(r.cap ?? '*').trim()
    let forza = -1
    if (!c || c === '*') forza = 0
    else {
      const rc = c.replace(/\D/g, '')
      if (!rc) continue
      if (rc === cifre) forza = 1000
      else if (rc.length < cifre.length && cifre.startsWith(rc)) forza = rc.length
    }
    if (forza >= 0 && (!migliore || forza > migliore.forza)) migliore = { forza, zona: r.zona_id }
  }
  return migliore ? migliore.zona : null
}

const alKg = (s: SupplementoAlKg | undefined, T: number) => (s ? Math.max(s.minimo, s.kg * T) : 0)

export type EsitoMulticollo = { nolo: number; fuelPct: number; zonaId: string; fasciaFinoA: number; pesoTotale: number; remota: number; partenza: number; minimo: number }

// Il nolo del multicollo dalle fasce della zona trovata. null = su questo livello quella spedizione
// NON ha prezzo (zona senza fasce, peso oltre l'ultima senza "oltre", partenza remota senza prezzo):
// il chiamante esclude il contratto, come per ogni destinazione senza prezzo.
//   fasceZona: le fasce del listino per la zona multicollo trovata (tipo fino_a / oltre)
//   zonaDest:  nome della zona del COLLO SINGOLO in cui cade la destinazione (per la localita' remota)
//   zonaMitt:  nome della zona di partenza del mittente, se c'e'
export function noloMulticolloDaFasce(p: {
  fasceZona: any[]; zonaId: string; T: number; colli: number; minimoCollo: number
  supplementi: SupplementiMulticollo | null; zonaDest?: string | null; zonaMitt?: string | null
}): EsitoMulticollo | null {
  if (!(p.colli > 1)) return null
  const finoA = (p.fasceZona || []).filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => Number(a.peso_max) - Number(b.peso_max))
  const oltre = (p.fasceZona || []).find((f: any) => f.tipo === 'oltre')
  let base: number | null = null, fuelPct = 0, fasciaFinoA = 0
  for (const f of finoA) {
    if (p.T <= Number(f.peso_max) + 1e-9) { base = Number(f.prezzo); fuelPct = Number(f.fuel) || 0; fasciaFinoA = Number(f.peso_max); break }
  }
  if (base == null && oltre && finoA.length) {
    // Stessa regola dei listini di sempre: ultima fascia + ogni tot kg oltre.
    const u = finoA[finoA.length - 1]
    base = Number(u.prezzo) + Math.ceil((p.T - Number(u.peso_max)) / (Number(oltre.peso_max) || 1) - 1e-9) * Number(oltre.prezzo)
    fuelPct = Number(u.fuel) || 0; fasciaFinoA = Math.ceil(p.T - 1e-9)
  }
  if (base == null || !(base > 0)) return null
  const remota = alKg(p.zonaDest ? p.supplementi?.remota?.[p.zonaDest] : undefined, p.T)
  let partenza = 0
  if (p.zonaMitt) {
    const s = p.supplementi?.partenza?.[p.zonaMitt]
    if (!s) return null   // partenza remota senza prezzo: non si vende ("non hai il prezzo, non vendi")
    partenza = alKg(s, p.T)
  }
  const minimo = p.minimoCollo > 0 ? r2(p.colli * p.minimoCollo) : 0
  return { nolo: Math.max(minimo, r2(base + remota + partenza)), fuelPct, zonaId: p.zonaId, fasciaFinoA, pesoTotale: p.T, remota: r2(remota), partenza: r2(partenza), minimo }
}

// I supplementi venduti sotto costo (stessa funzione per l'editor e per il Check sotto costo). Una zona
// remota col costo ma senza prezzo in vendita e' sotto costo: si venderebbe a prezzo di pianura.
export function supplementiSottoCosto(vendita: SupplementiMulticollo | null, costo: SupplementiMulticollo | null): string[] {
  if (!costo) return []
  const out: string[] = []
  for (const tipo of ['remota', 'partenza'] as const) {
    for (const [zona, c] of Object.entries(costo[tipo])) {
      const v = vendita?.[tipo]?.[zona]
      if (!v || v.minimo < c.minimo - 0.005 || v.kg < c.kg - 0.000005) out.push(`${tipo}|${zona}`)
    }
  }
  return out
}
