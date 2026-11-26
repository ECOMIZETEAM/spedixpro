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

// UPS ITALIA (verificato sui preventivi del 24/11, 131 su 141 al centesimo, gli altri a 1 centesimo) prezza il
// multicollo con tre cose che UPS Europa non ha, e che restano vuote per chi non le usa:
//   prezzo = il piu' alto fra   minimo_fisso + minimo per collo x colli          (0,93 + 7,587 x colli)
//                          e   tariffa sul totale + per_collo x colli + remoto    (+ 0,74 a collo)
//            + i supplementi "sempre", che si sommano DOPO, anche quando vale il minimo (isole minori +4,43:
//            Lipari 2 colli da 0,5 kg 20,64 = 16,21 di minimo + 4,43).
// Su UPS Europa la localita' remota si somma alla tariffa e non al minimo: e' il caso senza "sempre".
// `cumula` (solo partenza): il supplemento di partenza si paga anche se la destinazione sta nella stessa zona.
// UPS Italia (preventivi 26/11): da 01016 a 03034, 2x20 kg, +2,44 di partenza e +2,44 di destinazione. Senza,
// vale la regola di sempre (lib/pricing, zoneMittenteAgganciate): stessa zona = una volta sola (verificata su DVA).
export type SupplementoAlKg = { minimo: number; kg: number; sempre?: boolean; cumula?: boolean }
export type SupplementiMulticollo = {
  remota: Record<string, SupplementoAlKg>; partenza: Record<string, SupplementoAlKg>
  minimoFisso?: number   // JSON "minimo_fisso": euro per spedizione, sommati a minimo per collo x colli
  perCollo?: number      // JSON "per_collo": euro per ogni collo, sommati alla tariffa sul totale
  // JSON "minimo_collo_zona": minimo per collo per ZONA MULTICOLLO, al posto della voce unica 'minimo_collo'.
  // UPS Italia: 7,587 in zona A, 7,635 in zona B (Sicilia, Calabria, Sardegna); su 20 colli sono 0,96 €.
  minimoPerZona?: Record<string, number>
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function normalizzaSupplementiMulticollo(d: any): SupplementiMulticollo | null {
  if (!d || typeof d !== 'object') return null
  const alKg = (o: any): Record<string, SupplementoAlKg> => {
    const out: Record<string, SupplementoAlKg> = {}
    for (const [k, v] of Object.entries<any>(o || {})) {
      const minimo = Number(v?.minimo) || 0, kg = Number(v?.kg) || 0
      if (String(k).trim() && (minimo > 0 || kg > 0)) {
        const s: SupplementoAlKg = { minimo, kg }
        if (v?.sempre === true) s.sempre = true
        if (v?.cumula === true) s.cumula = true
        out[String(k).trim()] = s
      }
    }
    return out
  }
  const s: SupplementiMulticollo = { remota: alKg(d.remota), partenza: alKg(d.partenza) }
  // Entrambi i nomi: nel database li scrive lo script (minimo_fisso, per_collo) e li riscrive il salvataggio
  // del pannello, che registra l'oggetto gia' normalizzato (minimoFisso, perCollo). Leggendone uno solo, il
  // primo salvataggio dal pannello li faceva sparire.
  const mf = Number(d.minimo_fisso ?? d.minimoFisso) || 0, pc = Number(d.per_collo ?? d.perCollo) || 0
  if (mf > 0) s.minimoFisso = mf
  if (pc > 0) s.perCollo = pc
  const mz: Record<string, number> = {}
  for (const [k, v] of Object.entries<any>(d.minimo_collo_zona ?? d.minimoPerZona ?? {})) if (String(k).trim() && Number(v) > 0) mz[String(k).trim()] = Number(v)
  if (Object.keys(mz).length) s.minimoPerZona = mz
  return Object.keys(s.remota).length || Object.keys(s.partenza).length || mf > 0 || pc > 0 || Object.keys(mz).length ? s : null
}

// Il supplemento in un elenco di righe (gia' filtrato per listino e contratto). null = non c'e'.
export function leggiSupplementiMulticollo(suppl: any[]): SupplementiMulticollo | null {
  const riga = (suppl || []).find((s: any) => s?.tipo === TIPO_MULTICOLLO_SUPPLEMENTI)
  if (!riga) return null
  try { return normalizzaSupplementiMulticollo(typeof riga.descrizione === 'string' ? JSON.parse(riga.descrizione) : riga.descrizione) } catch { return null }
}

// Il peso come lo conta il fornitore: per ogni collo misure al centimetro in su, volume / divisore,
// il piu' alto fra peso e volume, arrotondato in su al PASSO; poi la somma.
// UPS Europa, passo mezzo chilo. Verificato: 15,1+15,1 kg = 31 (non 30,2); un collo 100x50x15,3 cm = 16 kg di
// volume (non 15,3); 100x45x45 = 40,5 (resta 40,5); 15 kg piccolo + 1 kg 100x50x25 = 40 (non 25,2).
// UPS Italia, passo un chilo (impostazione del contratto multicollo_arrotondamento_kg, preventivi del 26/11):
// 20 colli da 40,65 kg di volume = 820 (non 813); 9x25 + 1x25,5 kg = 251.
export function pesoMulticolloFornitore(packages: any[], divisore: number, passo = 0.5): number {
  const d = divisore > 0 ? divisore : 5000
  const s = passo > 0 ? passo : 0.5
  let tot = 0
  for (const p of packages || []) {
    const kg = Number(p?.weight ?? p?.peso) || 0
    const l = Math.ceil((Number(p?.length ?? p?.lunghezza) || 0) - 1e-9)
    const w = Math.ceil((Number(p?.width ?? p?.larghezza) || 0) - 1e-9)
    const h = Math.ceil((Number(p?.height ?? p?.altezza) || 0) - 1e-9)
    const vol = l > 0 && w > 0 && h > 0 ? (l * w * h) / d : 0
    tot += Math.ceil(Math.max(kg, vol) / s - 1e-9) * s
  }
  return Math.round(tot / s) * s
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

// `vinceMinimo`: il nolo e' il minimo (colli x minimo per collo + minimo fisso), supplementi "sempre" a parte.
export type EsitoMulticollo = { nolo: number; fuelPct: number; zonaId: string; fasciaFinoA: number; pesoTotale: number; remota: number; partenza: number; minimo: number; vinceMinimo?: boolean }

// Il nolo del multicollo dalle fasce della zona trovata. null = su questo livello quella spedizione
// NON ha prezzo (zona senza fasce, peso oltre l'ultima senza "oltre", partenza remota senza prezzo):
// il chiamante esclude il contratto, come per ogni destinazione senza prezzo.
//   fasceZona: le fasce del listino per la zona multicollo trovata (tipo fino_a / oltre)
//   zonaDest:  nome della zona del COLLO SINGOLO in cui cade la destinazione (per la localita' remota)
//   zonaMitt:  nome della zona di partenza del mittente, se c'e'
export function noloMulticolloDaFasce(p: {
  fasceZona: any[]; zonaId: string; T: number; colli: number; minimoCollo: number
  supplementi: SupplementiMulticollo | null; zonaDest?: string | null; zonaMitt?: string | null
  zonaNome?: string | null   // nome della zona MULTICOLLO trovata: serve al minimo per zona
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
  const sRemota = p.zonaDest ? p.supplementi?.remota?.[p.zonaDest] : undefined
  const remota = alKg(sRemota, p.T)
  let partenza = 0, sPartenza: SupplementoAlKg | undefined
  if (p.zonaMitt) {
    sPartenza = p.supplementi?.partenza?.[p.zonaMitt]
    if (!sPartenza) return null   // partenza remota senza prezzo: non si vende ("non hai il prezzo, non vendi")
    partenza = alKg(sPartenza, p.T)
  }
  // I supplementi "sempre" si sommano dopo il confronto col minimo; gli altri stanno dalla parte della tariffa.
  const sopra = (sRemota?.sempre ? remota : 0) + (sPartenza?.sempre ? partenza : 0)
  // Minimo per collo: quello della zona multicollo se il listino lo scrive, altrimenti la voce unica.
  const nomeZona = p.zonaNome ?? (p.fasceZona || []).find((f: any) => (f.zone as any)?.nome)?.zone?.nome
  const minimoCollo = (nomeZona && p.supplementi?.minimoPerZona?.[nomeZona]) || p.minimoCollo
  const minimo = minimoCollo > 0 ? r2(p.colli * minimoCollo + (p.supplementi?.minimoFisso || 0)) : 0
  const tariffa = r2(base + (p.supplementi?.perCollo || 0) * p.colli + remota + partenza - sopra)
  return { nolo: r2(Math.max(minimo, tariffa) + sopra), fuelPct, zonaId: p.zonaId, fasciaFinoA, pesoTotale: p.T, remota: r2(remota), partenza: r2(partenza), minimo, vinceMinimo: minimo > 0 && minimo >= tariffa }
}

// I supplementi venduti sotto costo (stessa funzione per l'editor e per il Check sotto costo). Una zona
// remota col costo ma senza prezzo in vendita e' sotto costo: si venderebbe a prezzo di pianura.
// `minimoVendita` / `minimoCosto`: la voce unica 'minimo_collo' dei due listini, che vale dove il listino non
// scrive un minimo per la zona. Il confronto e' fra i minimi EFFETTIVI zona per zona (`zoneMulticollo` + le zone
// scritte): un minimo di zona in vendita piu' basso della voce unica del costo e' sotto costo anche se il costo
// non ha minimi per zona (e una voce unica in vendita non risulta sotto costo a torto).
export function supplementiSottoCosto(vendita: SupplementiMulticollo | null, costo: SupplementiMulticollo | null, minimoVendita = 0, minimoCosto = 0, zoneMulticollo: string[] = []): string[] {
  if (!costo) return []
  const out: string[] = []
  for (const tipo of ['remota', 'partenza'] as const) {
    for (const [zona, c] of Object.entries(costo[tipo])) {
      const v = vendita?.[tipo]?.[zona]
      // "sempre" al costo e non in vendita: sul minimo il supplemento non si incassa ma si paga.
      if (!v || v.minimo < c.minimo - 0.005 || v.kg < c.kg - 0.000005 || (c.sempre && !v.sempre) || (c.cumula && !v.cumula)) out.push(`${tipo}|${zona}`)
    }
  }
  if ((costo.minimoFisso || 0) > (vendita?.minimoFisso || 0) + 0.005) out.push('regola|minimo_fisso')
  if ((costo.perCollo || 0) > (vendita?.perCollo || 0) + 0.00005) out.push('regola|per_collo')
  const zone = Array.from(new Set([...zoneMulticollo, ...Object.keys(costo.minimoPerZona || {}), ...Object.keys(vendita?.minimoPerZona || {})]))
  for (const zona of zone) {
    const c = costo.minimoPerZona?.[zona] || minimoCosto || 0
    const v = vendita?.minimoPerZona?.[zona] || minimoVendita || 0
    // Vendita senza minimo (0) non e' sotto costo qui: col minimo obbligatorio quel multicollo non si vende
    // (lib/pricing, noloMulticolloZone), e il campo vuoto lo segnala gia' l'editor.
    if (c > 0 && v > 0 && v < c - 0.0005) out.push(`regola|minimo_zona:${zona}`)
  }
  return out
}
