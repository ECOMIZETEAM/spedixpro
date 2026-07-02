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

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(id,nome), corrieri(id,tipo,nome_contratto)')
    .eq('listino_id', listinoId)
    .order('peso_max', { ascending: true })

  if (!fasce?.length) return null

  let fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === zonaNome)
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
    const fascia = trovaFascia(fasceDelCorriere, pesoFatturato)
    if (!fascia) continue
    const prezzo = Number(fascia.prezzo)
    if (!isFinite(prezzo)) continue
    if (!miglior || prezzo < miglior.prezzo) {
      miglior = { prezzo, corriereId: cId, pesoMax: parseFloat(fascia.peso_max) }
    }
  }

  if (!miglior) return null

  return {
    prezzo: Math.round(miglior.prezzo * 100) / 100,
    zona: zonaNome,
    peso_reale: pesoReale,
    peso_volume: Math.round(pesoVolume * 100) / 100,
    peso_fatturato: Math.round(pesoFatturato * 100) / 100,
    corriere_id: miglior.corriereId,
    fascia_peso_max: miglior.pesoMax,
  }
}
