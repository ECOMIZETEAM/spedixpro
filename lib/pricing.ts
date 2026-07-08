// Motore di pricing riutilizzabile.
// Dato UN listino qualsiasi (di un cliente o quello ereditato da un master),
// calcola il prezzo di trasporto (nolo) per una spedizione.
//
// Replica la stessa logica di app/api/spedizioni/tariffe/route.ts:
//   peso volumetrico (fattore_volume) -> zona (provincia) -> fascia (trovaFascia).
// NON gestisce contrassegno/assicurazione: per la cascata tra master conta il nolo.
//
// Usato dal ledger a cascata (STEP 4.5) per sapere quanto paga ogni master
// della catena col proprio listino ereditato.

import { trovaZoneMatch } from '@/lib/zone-match'

const ZONE_MAP: Record<string, string> = {
  CA:'Sardegna',CI:'Sardegna',VS:'Sardegna',NU:'Sardegna',OG:'Sardegna',OT:'Sardegna',OR:'Sardegna',SS:'Sardegna',
  AG:'Sicilia',CL:'Sicilia',CT:'Sicilia',EN:'Sicilia',ME:'Sicilia',PA:'Sicilia',RG:'Sicilia',SR:'Sicilia',TP:'Sicilia',
  CS:'Calabria',CZ:'Calabria',KR:'Calabria',RC:'Calabria',VV:'Calabria',
}

export function zonaDaProvincia(provincia: string): string {
  return ZONE_MAP[(provincia || '').toUpperCase().trim()] || 'Italia'
}

function trovaFascia(fasce: any[], peso: number) {
  const finoA = fasce.filter(f => f.tipo !== 'oltre').sort((a, b) => a.peso_max - b.peso_max)
  for (const f of finoA) {
    if (peso <= parseFloat(f.peso_max)) return f
  }
  const oltre = fasce.find(f => f.tipo === 'oltre')
  if (oltre) {
    const ultima = finoA[finoA.length - 1]
    if (ultima) {
      const kgExtra = peso - parseFloat(ultima.peso_max)
      const prezzoExtra = Math.ceil(kgExtra / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
      return { ...ultima, prezzo: parseFloat(ultima.prezzo) + prezzoExtra }
    }
  }
  // Peso oltre l'ultima fascia e nessuna fascia "oltre X ogni": nessun prezzo.
  return null
}

export type RisultatoPrezzo = {
  prezzo: number
  zona: string
  peso_reale: number
  peso_volume: number
  peso_fatturato: number
  corriere_id: string | null
  fascia_peso_max: number | null
} | null

// Dettaglio prezzo scorporato (per i report): nolo + sponda + fee contrassegno/assicurazione.
export type DettaglioPrezzo = {
  totale: number
  nolo: number
  sponda: number
  contrassegno: number
  assicurazione: number
}

// Calcola il prezzo di trasporto per un listino dato.
// Se corriereId è passato, usa le fasce di quel corriere; altrimenti prende
// il primo corriere disponibile per la zona (il più economico non è garantito:
// prende quello con la fascia valida più bassa). Ritorna null se non calcolabile.
export async function calcolaPrezzoListino(
  supabase: any,
  params: {
    listinoId: string
    provincia: string
    packages: any[]
    corriereId?: string | null
    cap?: string
    paese?: string
  }
): Promise<RisultatoPrezzo> {
  const { listinoId, provincia } = params
  const packages = Array.isArray(params.packages) && params.packages.length ? params.packages : [{ weight: 1 }]

  const zonaNome = zonaDaProvincia(provincia)

  const { data: listino } = await supabase
    .from('listini_clienti').select('fattore_volume,solo_peso_reale').eq('id', listinoId).single()
  const fattore = parseFloat(listino?.fattore_volume) || 5000

  const pesoReale = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
  let pesoVolume = 0
  for (const p of packages) {
    if (p?.length && p?.width && p?.height) pesoVolume += (p.length * p.width * p.height) / fattore
  }
  // "solo peso reale": ignora il volumetrico, si paga sempre sul peso reale
  const pesoFatturato = listino?.solo_peso_reale ? pesoReale : Math.max(pesoReale, pesoVolume)
  // agevolazione peso reale: valida solo se OGNI pacco e' entro 50x28x32 cm
  const entroMisureAgevolate = packages.every((p: any) => {
    const L = Number(p?.length)||0, W = Number(p?.width)||0, H = Number(p?.height)||0
    if (!L && !W && !H) return true
    const dims = [L, W, H].sort((a,b)=>b-a)
    const lim = [50, 32, 28]
    return dims[0] <= lim[0] && dims[1] <= lim[1] && dims[2] <= lim[2]
  })

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(id,nome), corrieri(id,tipo,nome_contratto,settings)')
    .eq('listino_id', listinoId)
    .order('peso_max', { ascending: true })

  if (!fasce?.length) return null

  // 1) Match via zone_cap (CAP esatto > provincia > jolly), ristretto alle zone del listino.
  const candidateZonaIds = fasce.map((f: any) => (f.zone as any)?.id).filter(Boolean)
  const zoneMatchIds = await trovaZoneMatch(
    supabase,
    { paese: params.paese, provincia, cap: params.cap },
    candidateZonaIds
  )
  let fasceZona = zoneMatchIds.length
    ? fasce.filter((f: any) => zoneMatchIds.includes((f.zone as any)?.id))
    : []
  // 2) Fallback ZONE_MAP per nome zona (compatibilita' listini senza zone_cap).
  if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === zonaNome)
  if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === 'Italia')
  if (!fasceZona.length) return null

  // Raggruppa per corriere
  const fascePerCorriere = new Map<string, any[]>()
  for (const f of fasceZona) {
    const cId = (f.corrieri as any)?.id
    if (!cId) continue
    if (!fascePerCorriere.has(cId)) fascePerCorriere.set(cId, [])
    fascePerCorriere.get(cId)!.push(f)
  }
  if (!fascePerCorriere.size) return null

  // Se è indicato un corriere preciso, usa quello; altrimenti scegli il prezzo più basso
  let miglior: { prezzo: number; corriereId: string; pesoMax: number } | null = null

  const entries = params.corriereId && fascePerCorriere.has(params.corriereId)
    ? [[params.corriereId, fascePerCorriere.get(params.corriereId)!]] as [string, any[]][]
    : Array.from(fascePerCorriere.entries())

  for (const [cId, fasceDelCorriere] of entries) {
    const settsC = (fasceDelCorriere[0]?.corrieri as any)?.settings || {}
    const usaPesoReale = !!settsC.agevolazione_peso_reale && entroMisureAgevolate
    const pesoPerFascia = usaPesoReale ? pesoReale : pesoFatturato
    const fascia = trovaFascia(fasceDelCorriere, pesoPerFascia)
    if (!fascia) continue
    const prezzo = Number(fascia.prezzo)
    if (!isFinite(prezzo)) continue
    if (!miglior || prezzo < miglior.prezzo) {
      miglior = { prezzo, corriereId: cId, pesoMax: parseFloat(fascia.peso_max) }
    }
  }

  if (!miglior) return null

  // Sponda: sopra soglia_kg, +prezzo_kg € per ogni kg oltre la soglia (sul peso fatturato).
  let sponda = 0
  try {
    const { data: sp } = await supabase.from('listini_clienti_supplementi')
      .select('descrizione,valore').eq('listino_id', listinoId).eq('corriere_id', miglior.corriereId).eq('tipo', 'sponda').maybeSingle()
    if (sp) {
      let d:any = null; try { d = JSON.parse(sp.descrizione) } catch {}
      const soglia = Number(d?.soglia_kg) || 0
      const prezzoKg = Number(sp.valore) || 0
      if (soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia) sponda = pesoFatturato * prezzoKg
    }
  } catch {}

  const zonaRisolta = (fasceZona[0]?.zone as any)?.nome || zonaNome

  return {
    prezzo: Math.round((miglior.prezzo + sponda) * 100) / 100,
    zona: zonaRisolta,
    peso_reale: pesoReale,
    peso_volume: Math.round(pesoVolume * 100) / 100,
    peso_fatturato: Math.round(pesoFatturato * 100) / 100,
    corriere_id: miglior.corriereId,
    fascia_peso_max: miglior.pesoMax,
  }
}


// Calcola il prezzo che il MASTER paga al CORRIERE (listino corriere) per una spedizione.
export async function calcolaPrezzoCorriere(
  supabase: any,
  params: {
    corriereId: string
    masterId: string
    provincia: string
    pesoReale: number
    packages?: any[]
    contrassegno?: number
    assicurazione?: number
    cap?: string
    paese?: string
  }
): Promise<number | null> {
  const { corriereId, masterId, provincia } = params
  const zonaNome = zonaDaProvincia(provincia)

  // Le fasce del listino corriere possono essere salvate sotto uno qualsiasi dei
  // listini del master (l'editor usa un listino unico + corriere_id). Cerchiamo
  // quindi in TUTTI i listini del master, filtrando per corriere_id.
  const { data: listini } = await supabase
    .from('listini_corrieri')
    .select('id,fattore_volume,solo_peso_reale')
    .eq('master_id', masterId)
  if (!listini?.length) return null
  const listinoIds = listini.map((l: any) => l.id)
  const fattore = parseFloat(listini[0].fattore_volume) || 5000
  const soloPesoReale = listini.some((l: any) => l.solo_peso_reale)

  const packages = Array.isArray(params.packages) && params.packages.length ? params.packages : []
  let pesoVolume = 0
  for (const p of packages) {
    if (p?.length && p?.width && p?.height) pesoVolume += (p.length * p.width * p.height) / fattore
  }
  const pesoReale = Number(params.pesoReale) || 1
  const pesoFatturato = soloPesoReale ? pesoReale : Math.max(pesoReale, pesoVolume)

  const { data: fasce } = await supabase
    .from('listini_corrieri_fasce')
    .select('*, zone(id,nome)')
    .in('listino_id', listinoIds)
    .eq('corriere_id', corriereId)
    .order('peso_max', { ascending: true })
  if (!fasce?.length) return null

  const candidateZonaIds = fasce.map((f: any) => (f.zone as any)?.id).filter(Boolean)
  const zoneMatchIds = await trovaZoneMatch(
    supabase,
    { paese: params.paese, provincia, cap: params.cap },
    candidateZonaIds
  )
  let fasceZona = zoneMatchIds.length
    ? fasce.filter((f: any) => zoneMatchIds.includes((f.zone as any)?.id))
    : []
  if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === zonaNome)
  if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === 'Italia')
  if (!fasceZona.length) return null

  const finoA = fasceZona.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => a.peso_max - b.peso_max)
  const oltre = fasceZona.find((f: any) => f.tipo === 'oltre')
  let prezzo = 0
  let trovata = false
  for (const f of finoA) {
    if (pesoFatturato <= parseFloat(f.peso_max)) { prezzo = parseFloat(f.prezzo); trovata = true; break }
  }
  if (!trovata) {
    if (oltre && finoA.length) {
      const ultima = finoA[finoA.length - 1]
      const kgExtra = pesoFatturato - parseFloat(ultima.peso_max)
      prezzo = parseFloat(ultima.prezzo) + Math.ceil(kgExtra / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
    } else return null   // peso oltre l'ultima fascia e nessuna "oltre": nessun prezzo
  }

  const { data: suppl } = await supabase
    .from('listini_corrieri_supplementi')
    .select('tipo,valore,tipo_calcolo,descrizione')
    .in('listino_id', listinoIds)
    .eq('corriere_id', corriereId)

  const cod = Number(params.contrassegno) || 0
  const ass = Number(params.assicurazione) || 0
  const nolo = prezzo // base per il calcolo percentuale (prima di aggiungere i supplementi)

  // Scaglioni contrassegno/assicurazione, stesso formato del listino cliente:
  // descrizione = { valore_max, prezzo_fisso, perc, calcolo_su }
  function applicaScaglione(tipo: string, importo: number): number {
    if (importo <= 0) return 0
    const scal = (suppl || [])
      .filter((s: any) => s.tipo === tipo)
      .map((s: any) => {
        let d: any = null; try { d = JSON.parse(s.descrizione) } catch {}
        return {
          valore_max: parseFloat(d?.valore_max ?? '') || 0,
          prezzo_fisso: parseFloat(d?.prezzo_fisso ?? s.valore ?? '') || 0,
          perc: parseFloat(d?.perc ?? '') || 0,
          calcolo_su: d?.calcolo_su || s.tipo_calcolo || 'totale',
        }
      })
      .sort((a: any, b: any) => a.valore_max - b.valore_max)
    if (!scal.length) return 0
    const s = scal.find((x: any) => importo <= x.valore_max) || scal[scal.length - 1]
    // 'totale' = intero importo; 'differenza' = importo meno il massimo della prima fascia
    const primaFasciaMax = Number(scal[0]?.valore_max) || 0
    const base = s.calcolo_su === 'differenza' ? Math.max(0, importo - primaFasciaMax) : importo
    return s.prezzo_fisso + (s.perc / 100) * base
  }
  // Sponda: sopra soglia_kg, +prezzo_kg € per ogni kg oltre la soglia (peso fatturato).
  const spondaRow = (suppl || []).find((s: any) => s.tipo === 'sponda')
  if (spondaRow) {
    let d: any = null; try { d = JSON.parse(spondaRow.descrizione) } catch {}
    const soglia = Number(d?.soglia_kg) || 0
    const prezzoKg = Number(spondaRow.valore) || 0
    if (soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia) prezzo += pesoFatturato * prezzoKg
  }

  prezzo += applicaScaglione('contrassegno', cod)
  prezzo += applicaScaglione('assicurazione', ass)

  return Math.round(prezzo * 100) / 100
}


// Calcola i supplementi contrassegno/assicurazione a carico del CLIENTE per un
// contratto, con la STESSA logica a scaglioni del portale (tariffe/route.ts).
// Ritorna le fee da aggiungere al nolo; disponibile=false se l'importo COD/assic
// supera il massimo scaglione (il contratto non copre quell'importo).
export async function calcolaSupplementiCliente(
  supabase: any,
  params: { listinoId: string; corriereId: string; contrassegno?: number; assicurazione?: number; valoreMerce?: number; nolo: number }
): Promise<{ contrassegno: number; assicurazione: number; disponibile: boolean }> {
  const cod = Number(params.contrassegno) || 0
  const ass = Number(params.assicurazione) || 0
  const valoreMerce = Number(params.valoreMerce) || 0
  const nolo = Number(params.nolo) || 0
  if (cod <= 0 && ass <= 0) return { contrassegno: 0, assicurazione: 0, disponibile: true }

  const { data: suppl } = await supabase
    .from('listini_clienti_supplementi')
    .select('tipo, descrizione, valore, tipo_calcolo')
    .eq('listino_id', params.listinoId)
    .eq('corriere_id', params.corriereId)
    .in('tipo', ['contrassegno', 'assicurazione'])

  const scaglioni = (tipo: string) => (suppl || [])
    .filter((s: any) => s.tipo === tipo)
    .map((s: any) => {
      let d: any = null; try { d = JSON.parse(s.descrizione) } catch {}
      return {
        valore_max: parseFloat(d?.valore_max ?? '') || 0,
        prezzo_fisso: parseFloat(d?.prezzo_fisso ?? s.valore ?? '') || 0,
        perc: parseFloat(d?.perc ?? '') || 0,
        calcolo_su: d?.calcolo_su || s.tipo_calcolo || 'totale',
      }
    })
    .sort((a: any, b: any) => a.valore_max - b.valore_max)

  const applica = (tipo: string, importo: number): number | null => {
    if (importo <= 0) return 0
    const scal = scaglioni(tipo)
    if (!scal.length) return 0
    const s = scal.find((x: any) => importo <= x.valore_max)
    if (!s) return null // oltre il massimo -> contratto non disponibile per quell'importo
    // 'totale' = intero importo del supplemento; 'differenza' = importo meno il massimo della prima fascia
    const primaFasciaMax = Number(scal[0]?.valore_max) || 0
    const base = s.calcolo_su === 'differenza' ? Math.max(0, importo - primaFasciaMax) : importo
    return s.prezzo_fisso + (s.perc / 100) * base
  }

  const feeCod = applica('contrassegno', cod)
  const feeAss = applica('assicurazione', ass)
  if (feeCod === null || feeAss === null) return { contrassegno: 0, assicurazione: 0, disponibile: false }
  return { contrassegno: feeCod, assicurazione: feeAss, disponibile: true }
}

// Versione BATCH: precarica UNA volta i listini/fasce/supplementi/zone_cap del master
// e ritorna una funzione che calcola il prezzo corriere per una spedizione in memoria,
// senza query per riga. Risultato identico a calcolaPrezzoCorriere (usato dai report).
export async function creaCalcolatoreCorriere(
  supabase: any,
  masterId: string
): Promise<(s: any) => DettaglioPrezzo | null> {
  const { data: listini } = await supabase
    .from('listini_corrieri').select('id,corriere_id,fattore_volume')
    .eq('master_id', masterId).eq('attivo', true)
  const listinoPerCorriere = new Map<string, { id: string; fattore: number }>()
  const listinoIds: string[] = []
  for (const l of listini || []) {
    listinoPerCorriere.set(l.corriere_id, { id: l.id, fattore: parseFloat(l.fattore_volume) || 5000 })
    listinoIds.push(l.id)
  }

  const { data: fasce } = listinoIds.length
    ? await supabase.from('listini_corrieri_fasce').select('listino_id,peso_max,prezzo,tipo,zona_id,zone(id,nome)').in('listino_id', listinoIds)
    : { data: [] }
  const fascePerListino = new Map<string, any[]>()
  for (const f of fasce || []) {
    if (!fascePerListino.has(f.listino_id)) fascePerListino.set(f.listino_id, [])
    fascePerListino.get(f.listino_id)!.push(f)
  }

  const { data: suppl } = listinoIds.length
    ? await supabase.from('listini_corrieri_supplementi').select('listino_id,tipo,valore,tipo_calcolo,descrizione').in('listino_id', listinoIds)
    : { data: [] }
  const supplPerListino = new Map<string, any[]>()
  for (const s of suppl || []) {
    if (!supplPerListino.has(s.listino_id)) supplPerListino.set(s.listino_id, [])
    supplPerListino.get(s.listino_id)!.push(s)
  }

  const zonaIds = Array.from(new Set((fasce || []).map((f: any) => f.zone?.id).filter(Boolean)))
  const { data: zc } = zonaIds.length
    ? await supabase.from('zone_cap').select('zona_id,paese,provincia,cap').in('zona_id', zonaIds)
    : { data: [] }
  const zcByPaese = new Map<string, any[]>()
  for (const r of zc || []) {
    const k = (r.paese || '').toUpperCase()
    if (!zcByPaese.has(k)) zcByPaese.set(k, [])
    zcByPaese.get(k)!.push(r)
  }

  function matchZona(paese: string, provincia: string, cap: string, cand: string[]): string[] {
    const rows = (zcByPaese.get((paese || 'IT').toUpperCase()) || []).filter((r: any) => cand.includes(r.zona_id))
    let m = rows.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
    if (!m.length) m = rows.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*'))
    if (!m.length) m = rows.filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))
    return Array.from(new Set(m.map((r: any) => r.zona_id)))
  }

  return function prezzoCorriereRow(s: any): DettaglioPrezzo | null {
    const lc = listinoPerCorriere.get(s.corriere_id)
    if (!lc) return null
    const fasceList = fascePerListino.get(lc.id) || []
    if (!fasceList.length) return null

    const L = Number(s.lunghezza) || 0, W = Number(s.larghezza) || 0, H = Number(s.altezza) || 0
    const pesoVolume = (L && W && H) ? (L * W * H) / lc.fattore : 0
    const pesoReale = Number(s.peso_reale) || 1
    const pesoFatturato = Math.max(pesoReale, pesoVolume)

    const provincia = (s.dest_provincia || '').toUpperCase().trim()
    const cap = (s.dest_cap || '').trim()
    const paese = (s.dest_paese || 'IT').toUpperCase().trim()
    const cand = fasceList.map((f: any) => f.zone?.id).filter(Boolean)
    const ids = matchZona(paese, provincia, cap, cand)
    const zonaNome = zonaDaProvincia(provincia)
    let fz = ids.length ? fasceList.filter((f: any) => ids.includes(f.zone?.id)) : []
    if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === zonaNome)
    if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === 'Italia')
    if (!fz.length) return null

    const finoA = fz.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => a.peso_max - b.peso_max)
    const oltre = fz.find((f: any) => f.tipo === 'oltre')
    let prezzo = 0, trovata = false
    for (const f of finoA) { if (pesoFatturato <= parseFloat(f.peso_max)) { prezzo = parseFloat(f.prezzo); trovata = true; break } }
    if (!trovata) {
      if (oltre && finoA.length) {
        const u = finoA[finoA.length - 1]
        prezzo = parseFloat(u.prezzo) + Math.ceil((pesoFatturato - parseFloat(u.peso_max)) / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
      } else return null   // peso oltre l'ultima fascia e nessuna "oltre": nessun prezzo
    }

    const nolo = prezzo
    const supplList = supplPerListino.get(lc.id) || []
    const cod = Number(s.contrassegno) || 0, ass = Number(s.assicurazione) || 0
    const applica = (tipo: string, importo: number): number => {
      if (importo <= 0) return 0
      const scal = supplList.filter((x: any) => x.tipo === tipo).map((x: any) => {
        let d: any = null; try { d = JSON.parse(x.descrizione) } catch {}
        return { vm: parseFloat(d?.valore_max ?? '') || 0, pf: parseFloat(d?.prezzo_fisso ?? x.valore ?? '') || 0, pc: parseFloat(d?.perc ?? '') || 0, cs: d?.calcolo_su || x.tipo_calcolo || 'totale' }
      }).sort((a: any, b: any) => a.vm - b.vm)
      if (!scal.length) return 0
      const sc = scal.find((x: any) => importo <= x.vm) || scal[scal.length - 1]
      // 'totale' = intero importo; 'differenza' = importo meno il massimo della prima fascia
      const primaFasciaMax = Number(scal[0]?.vm) || 0
      const base = sc.cs === 'differenza' ? Math.max(0, importo - primaFasciaMax) : importo
      return sc.pf + (sc.pc / 100) * base
    }
    // Sponda: la soglia è solo il trigger, poi prezzo/kg sul TOTALE dei kg (peso fatturato).
    const noloBase = prezzo
    let spondaAmt = 0
    const spRow = supplList.find((x: any) => x.tipo === 'sponda')
    if (spRow) {
      let sd: any = null; try { sd = JSON.parse(spRow.descrizione) } catch {}
      const soglia = Number(sd?.soglia_kg) || 0
      const prezzoKg = Number(spRow.valore) || 0
      if (soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia) spondaAmt = pesoFatturato * prezzoKg
    }
    const feeContr = applica('contrassegno', cod)
    const feeAss = applica('assicurazione', ass)
    const _r2 = (n: number) => Math.round(n * 100) / 100
    return { totale: _r2(noloBase + spondaAmt + feeContr + feeAss), nolo: _r2(noloBase), sponda: _r2(spondaAmt), contrassegno: _r2(feeContr), assicurazione: _r2(feeAss) }
  }
}

// Calcolatore batch sul LISTINO CLIENTE (listini_clienti). Usato per il COSTO dei
// sotto-master: il loro costo è il listino che il master padre gli ha assegnato
// (masters.parent_listino_id). Stessa logica di calcolaPrezzoListino, ma in memoria.
export async function creaCalcolatoreListinoCliente(
  supabase: any,
  listinoId: string
): Promise<(s: any) => DettaglioPrezzo | null> {
  if (!listinoId) return () => null
  const { data: listino } = await supabase.from('listini_clienti').select('fattore_volume,solo_peso_reale').eq('id', listinoId).single()
  const fattore = parseFloat(listino?.fattore_volume) || 5000
  const soloPesoReale = !!listino?.solo_peso_reale

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce').select('corriere_id,zona_id,peso_max,prezzo,tipo,zone(id,nome)')
    .eq('listino_id', listinoId)
  const fascePerCorriere = new Map<string, any[]>()
  for (const f of fasce || []) {
    if (!fascePerCorriere.has(f.corriere_id)) fascePerCorriere.set(f.corriere_id, [])
    fascePerCorriere.get(f.corriere_id)!.push(f)
  }

  const { data: suppl } = await supabase
    .from('listini_clienti_supplementi').select('corriere_id,tipo,valore,tipo_calcolo,descrizione')
    .eq('listino_id', listinoId).in('tipo', ['contrassegno', 'assicurazione'])
  const supplPerCorriere = new Map<string, any[]>()
  for (const s of suppl || []) {
    if (!supplPerCorriere.has(s.corriere_id)) supplPerCorriere.set(s.corriere_id, [])
    supplPerCorriere.get(s.corriere_id)!.push(s)
  }

  const zonaIds = Array.from(new Set((fasce || []).map((f: any) => f.zone?.id).filter(Boolean)))
  const { data: zc } = zonaIds.length
    ? await supabase.from('zone_cap').select('zona_id,paese,provincia,cap').in('zona_id', zonaIds)
    : { data: [] }
  const zcByPaese = new Map<string, any[]>()
  for (const r of zc || []) {
    const k = (r.paese || '').toUpperCase()
    if (!zcByPaese.has(k)) zcByPaese.set(k, [])
    zcByPaese.get(k)!.push(r)
  }
  function matchZona(paese: string, provincia: string, cap: string, cand: string[]): string[] {
    const rows = (zcByPaese.get((paese || 'IT').toUpperCase()) || []).filter((r: any) => cand.includes(r.zona_id))
    let m = rows.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
    if (!m.length) m = rows.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*'))
    if (!m.length) m = rows.filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))
    return Array.from(new Set(m.map((r: any) => r.zona_id)))
  }

  return function prezzoListinoRow(s: any): DettaglioPrezzo | null {
    const fasceList = fascePerCorriere.get(s.corriere_id) || []
    if (!fasceList.length) return null

    const L = Number(s.lunghezza) || 0, W = Number(s.larghezza) || 0, H = Number(s.altezza) || 0
    const pesoVolume = (L && W && H) ? (L * W * H) / fattore : 0
    const pesoReale = Number(s.peso_reale) || 1
    const pesoFatturato = soloPesoReale ? pesoReale : Math.max(pesoReale, pesoVolume)

    const provincia = (s.dest_provincia || '').toUpperCase().trim()
    const cap = (s.dest_cap || '').trim()
    const paese = (s.dest_paese || 'IT').toUpperCase().trim()
    const cand = fasceList.map((f: any) => f.zone?.id).filter(Boolean)
    const ids = matchZona(paese, provincia, cap, cand)
    const zonaNome = zonaDaProvincia(provincia)
    let fz = ids.length ? fasceList.filter((f: any) => ids.includes(f.zone?.id)) : []
    if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === zonaNome)
    if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === 'Italia')
    if (!fz.length) return null

    const finoA = fz.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => a.peso_max - b.peso_max)
    const oltre = fz.find((f: any) => f.tipo === 'oltre')
    let prezzo = 0, trovata = false
    for (const f of finoA) { if (pesoFatturato <= parseFloat(f.peso_max)) { prezzo = parseFloat(f.prezzo); trovata = true; break } }
    if (!trovata) {
      if (oltre && finoA.length) {
        const u = finoA[finoA.length - 1]
        prezzo = parseFloat(u.prezzo) + Math.ceil((pesoFatturato - parseFloat(u.peso_max)) / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
      } else return null   // peso oltre l'ultima fascia e nessuna "oltre": nessun prezzo
    }

    const supplList = supplPerCorriere.get(s.corriere_id) || []
    const cod = Number(s.contrassegno) || 0, ass = Number(s.assicurazione) || 0
    const applica = (tipo: string, importo: number): number => {
      if (importo <= 0) return 0
      const scal = supplList.filter((x: any) => x.tipo === tipo).map((x: any) => {
        let d: any = null; try { d = JSON.parse(x.descrizione) } catch {}
        return { vm: parseFloat(d?.valore_max ?? '') || 0, pf: parseFloat(d?.prezzo_fisso ?? x.valore ?? '') || 0, pc: parseFloat(d?.perc ?? '') || 0, cs: d?.calcolo_su || x.tipo_calcolo || 'totale' }
      }).sort((a: any, b: any) => a.vm - b.vm)
      if (!scal.length) return 0
      const sc = scal.find((x: any) => importo <= x.vm) || scal[scal.length - 1]
      const primaFasciaMax = Number(scal[0]?.vm) || 0
      const base = sc.cs === 'differenza' ? Math.max(0, importo - primaFasciaMax) : importo
      return sc.pf + (sc.pc / 100) * base
    }
    // Sponda: la soglia è solo il trigger, poi prezzo/kg sul TOTALE dei kg (peso fatturato).
    const noloBase = prezzo
    let spondaAmt = 0
    const spRow = supplList.find((x: any) => x.tipo === 'sponda')
    if (spRow) {
      let sd: any = null; try { sd = JSON.parse(spRow.descrizione) } catch {}
      const soglia = Number(sd?.soglia_kg) || 0
      const prezzoKg = Number(spRow.valore) || 0
      if (soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia) spondaAmt = pesoFatturato * prezzoKg
    }
    const feeContr = applica('contrassegno', cod)
    const feeAss = applica('assicurazione', ass)
    const _r2 = (n: number) => Math.round(n * 100) / 100
    return { totale: _r2(noloBase + spondaAmt + feeContr + feeAss), nolo: _r2(noloBase), sponda: _r2(spondaAmt), contrassegno: _r2(feeContr), assicurazione: _r2(feeAss) }
  }
}