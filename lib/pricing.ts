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
  return finoA[finoA.length - 1] || null
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
    .from('listini_clienti').select('fattore_volume').eq('id', listinoId).single()
  const fattore = parseFloat(listino?.fattore_volume) || 5000

  const pesoReale = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
  let pesoVolume = 0
  for (const p of packages) {
    if (p?.length && p?.width && p?.height) pesoVolume += (p.length * p.width * p.height) / fattore
  }
  const pesoFatturato = Math.max(pesoReale, pesoVolume)
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

  const zonaRisolta = (fasceZona[0]?.zone as any)?.nome || zonaNome

  return {
    prezzo: Math.round(miglior.prezzo * 100) / 100,
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

  const { data: listino } = await supabase
    .from('listini_corrieri')
    .select('id,fattore_volume')
    .eq('master_id', masterId)
    .eq('corriere_id', corriereId)
    .eq('attivo', true)
    .limit(1)
    .single()
  if (!listino?.id) return null
  const fattore = parseFloat(listino.fattore_volume) || 5000

  const packages = Array.isArray(params.packages) && params.packages.length ? params.packages : []
  let pesoVolume = 0
  for (const p of packages) {
    if (p?.length && p?.width && p?.height) pesoVolume += (p.length * p.width * p.height) / fattore
  }
  const pesoReale = Number(params.pesoReale) || 1
  const pesoFatturato = Math.max(pesoReale, pesoVolume)

  const { data: fasce } = await supabase
    .from('listini_corrieri_fasce')
    .select('*, zone(id,nome)')
    .eq('listino_id', listino.id)
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
    } else if (finoA.length) {
      prezzo = parseFloat(finoA[finoA.length - 1].prezzo)
    } else return null
  }

  const { data: suppl } = await supabase
    .from('listini_corrieri_supplementi')
    .select('tipo,valore,tipo_calcolo,descrizione')
    .eq('listino_id', listino.id)

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
    const base = s.calcolo_su === 'valore_merce' ? 0 : nolo
    return s.prezzo_fisso + (s.perc / 100) * base
  }
  prezzo += applicaScaglione('contrassegno', cod)
  prezzo += applicaScaglione('assicurazione', ass)

  return Math.round(prezzo * 100) / 100
}