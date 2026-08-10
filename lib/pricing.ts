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

import { trovaZoneMatchDett, isZonaEsclusiva, zoneEsclusiveMaster, filtraCapCondiviso, rigaValePerCitta } from '@/lib/zone-match'
import { fetchAll } from '@/lib/fetch-all'
import { entroMisureAgevolate, pesoSuReale } from '@/lib/agevolazione-misure'

const ZONE_MAP: Record<string, string> = {
  CA:'Sardegna',CI:'Sardegna',VS:'Sardegna',NU:'Sardegna',OG:'Sardegna',OT:'Sardegna',OR:'Sardegna',SS:'Sardegna',SU:'Sardegna',
  AG:'Sicilia',CL:'Sicilia',CT:'Sicilia',EN:'Sicilia',ME:'Sicilia',PA:'Sicilia',RG:'Sicilia',SR:'Sicilia',TP:'Sicilia',
  CS:'Calabria',CZ:'Calabria',KR:'Calabria',RC:'Calabria',VV:'Calabria',
}

export function zonaDaProvincia(provincia: string): string {
  return ZONE_MAP[(provincia || '').toUpperCase().trim()] || 'Italia'
}

// Fattore volume EFFETTIVO per un corriere sul LISTINO CLIENTE (ricavo).
// Override per-corriere in listini_clienti_corrieri, fallback default del listino, poi 5000.
export async function fattoreVolumeCliente(supabase: any, listinoId: string, corriereId: string): Promise<number> {
  if (!listinoId) return 5000
  const { data: lk } = await supabase.from('listini_clienti').select('fattore_volume').eq('id', listinoId).maybeSingle()
  let f = parseFloat(lk?.fattore_volume) || 5000
  if (corriereId) {
    const { data: ov } = await supabase.from('listini_clienti_corrieri')
      .select('fattore_volume').eq('listino_id', listinoId).eq('corriere_id', corriereId).maybeSingle()
    const fv = parseFloat(ov?.fattore_volume); if (fv > 0) f = fv
  }
  return f
}

// FATTORE VOLUMETRICO DI UN CONTRATTO — di chi e' la parola.
//
// Il divisore non e' una costante nostra: e' una CONDIZIONE del contratto, che il master di sopra
// assegna insieme al contratto quando lo propaga. Quindi chi non ne ha uno suo non prende un
// valore inventato: eredita quello di chi gliel'ha dato, salendo la catena fino al proprietario
// del contratto. Il 5000 resta solo come ultimissimo ripiego, se non l'ha mai impostato nessuno.
//
// Prima, se il corriere non aveva un listino suo, si prendeva il PRIMO listino del master — cioe'
// il fattore di un ALTRO contratto. Velox ha dodici listini con fattori 3333, 4000 e 5000 e la
// query non aveva un ordinamento: per un contratto senza listino proprio il divisore usciva a caso
// fra quelli. Un collo 60x50x40 poteva contare 24 kg o 36 kg a seconda di come girava.

// Il fattore che UN master ha impostato per QUESTO corriere: override per-corriere, altrimenti il
// default del listino legato a quel corriere. `null` = questo master non l'ha impostato.
async function fattoreDiUnMaster(supabase: any, masterId: string, corriereId: string): Promise<number | null> {
  const { data: listini } = await supabase.from('listini_corrieri')
    .select('id,corriere_id,fattore_volume').eq('master_id', masterId)
  if (!listini?.length) return null
  const listinoIds = listini.map((l: any) => l.id)

  const { data: ov } = await supabase.from('listini_corrieri_corrieri')
    .select('listino_id,fattore_volume').in('listino_id', listinoIds).eq('corriere_id', corriereId)
    .order('listino_id', { ascending: true })      // stesso risultato a ogni chiamata, non a caso
  const righe = (ov || []).filter((a: any) => parseFloat(a?.fattore_volume) > 0)
  const proprio = listini.find((l: any) => l.corriere_id === corriereId)
  const scelto = righe.find((a: any) => a.listino_id === proprio?.id) || righe[0]
  const fv = parseFloat(scelto?.fattore_volume)
  if (fv > 0) return fv

  const def = parseFloat(proprio?.fattore_volume)
  return def > 0 ? def : null
}

// Fattore volume EFFETTIVO per un corriere sul LISTINO CORRIERE (costo del master), con eredita'.
export async function fattoreVolumeCorriere(supabase: any, masterId: string, corriereId: string): Promise<number> {
  if (!masterId || !corriereId) return 5000
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    const f = await fattoreDiUnMaster(supabase, cur, corriereId)
    if (f && f > 0) return f
    const { data: m }: { data: any } = await supabase.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = m?.parent_master_id || null
  }
  return 5000
}

// Peso fatturato (max tra reale e volumetrico) sul TOTALE dei colli, dato un fattore.
// IL PESO FATTURATO SI DECIDE COLLO PER COLLO, come fa il corriere.
//
// Prima si sommava tutto e si confrontava dopo: max(somma dei pesi, somma dei volumi). Il corriere
// fa il contrario — per OGNI collo prende il maggiore fra il suo peso e il suo volume, e poi somma.
// Su un collo solo le due cose coincidono sempre, ed e' per questo che nessuno se n'era accorto.
// Sul multicollo no: se un collo e' pesante e uno voluminoso, il sorpasso del secondo viene
// assorbito dal peso del primo e sparisce.
//
// Caso vero (3UW1WLJ008202): due colli da 10 kg, 22x55x39 e 37x57x25.
//   a somme:        peso 20, volume 19,98        -> 20,00 kg -> fascia 0-20 -> 6,99
//   collo per collo: max(10;9,44) + max(10;10,54) -> 20,54 kg -> fascia 0-30 -> 8,23
// Il fornitore ci ha addebitato 1,24, cioe' esattamente la differenza fra quelle due fasce: la sua
// tariffa e' identica alla nostra, era il conto del peso a essere diverso.
//
// Misurato prima di cambiare: su 516 multicollo in 30 giorni, 118 erano contate meno del corriere
// (491 kg non fatturati, fino a 39 kg su una singola spedizione) e in 35 casi cambiava la fascia.
// Quelle le pagavamo noi, e ce ne accorgevamo solo settimane dopo, dal file delle ripesature.
export function calcolaPesoFatturato(packages: any[], fattore: number, soloPesoReale = false): { pesoReale: number; pesoVolume: number; pesoFatturato: number } {
  const pks = Array.isArray(packages) ? packages : []
  const f = fattore > 0 ? fattore : 5000
  let pesoReale = 0, pesoVolume = 0
  for (const p of pks) {
    const peso = parseFloat(p?.weight) || 0
    const L = parseFloat(p?.length) || 0, W = parseFloat(p?.width) || 0, H = parseFloat(p?.height) || 0
    // Un collo senza misure vale il suo peso: non si inventa un volume che non conosciamo.
    const vol = (L && W && H) ? (L * W * H) / f : 0
    pesoReale += peso
    pesoVolume += vol
  }
  // PESO FATTURATO = SOMMA DEI VOLUMI, non collo-per-collo.
  // Si confronta il peso REALE TOTALE col VOLUME TOTALE e si prende il più alto — è la regola del
  // gestionale. Prima si sommava il massimo(reale,volume) di OGNI collo: su una multicollo con una
  // scatola densa e una ingombrante il risultato usciva più alto della regola (es. 30 kg reali
  // fatturati 30,48), sovra-fatturando il cliente. Su una spedizione mono-collo i due metodi danno
  // lo stesso identico numero (nessuna spedizione a un collo cambia).
  const pesoFatturato = soloPesoReale ? pesoReale : Math.max(pesoReale, pesoVolume)
  return { pesoReale, pesoVolume, pesoFatturato }
}

function trovaFascia(fasce: any[], peso: number) {
  const finoA = fasce.filter(f => f.tipo !== 'oltre').sort((a, b) => a.peso_max - b.peso_max)
  // PIU' ZONE PER LO STESSO CAP: succede spesso che un CAP compaia sia in "Isole Minori" sia in
  // "Zone Disagiate" dello stesso contratto (in produzione capita su 2.336 CAP). In quel caso qui
  // arrivavano le fasce di ENTRAMBE le zone e vinceva quella che il database restituiva per prima:
  // lo stesso CAP poteva essere prezzato in due modi diversi da una richiesta all'altra, e il
  // preventivo poteva non coincidere con l'addebito. A parita' di scaglione si prende ora la piu'
  // CARA: e' deterministico, ed e' il verso giusto (una destinazione doppiamente speciale non deve
  // costare meno di quanto costa a noi).
  const primo = finoA.find(f => peso <= parseFloat(f.peso_max))
  if (primo) {
    const stessoScaglione = finoA.filter(f => parseFloat(f.peso_max) === parseFloat(primo.peso_max))
    return stessoScaglione.reduce((a, b) => (parseFloat(b.prezzo) > parseFloat(a.prezzo) ? b : a), primo)
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

// Dettaglio del prezzo del LISTINO CORRIERE, scorporato in voci (per la spedizione propria del master).
export type DettaglioCorriere = {
  totale: number
  nolo: number
  fuel: number
  sponda: number
  contrassegno: number
  assicurazione: number
  peso_reale: number       // somma pesi reali dei colli
  peso_volume: number      // somma volumetrici dei colli col fattore del corriere
  peso_fatturato: number   // peso EFFETTIVO su cui è tassato (reale se agevolazione, altrimenti volumetrico)
  contrassegnoOltreMax?: boolean   // COD richiesto oltre il max (o senza tariffa) -> corriere da escludere
  assicurazioneOltreMax?: boolean  // assicurazione richiesta oltre il max -> corriere da escludere
  // QUALE ZONA HA VINTO. Serve a confrontare la zona che risolve il COSTO di un master con quella
  // che risolve il PREZZO del cliente: se sulla stessa spedizione escono due zone diverse, qualcuno
  // compra isola e vende pianura. Senza questo nome, quella differenza non si puo' nemmeno vedere.
  zona?: string
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
    citta?: string   // città destinazione: distingue i CAP condivisi tra più comuni (zona disagiata vs Italia)
  }
): Promise<RisultatoPrezzo> {
  const { listinoId, provincia } = params
  const packages = Array.isArray(params.packages) && params.packages.length ? params.packages : [{ weight: 1 }]

  const zonaNome = zonaDaProvincia(provincia)

  const { data: listino } = await supabase
    .from('listini_clienti').select('fattore_volume,solo_peso_reale,master_id').eq('id', listinoId).single()
  let fattore = parseFloat(listino?.fattore_volume) || 5000
  // Override PER-CORRIERE (come nel listino corriere): il peso fatturato deve usare lo stesso fattore.
  if (params.corriereId) {
    const { data: agg } = await supabase.from('listini_clienti_corrieri')
      .select('fattore_volume').eq('listino_id', listinoId).eq('corriere_id', params.corriereId).maybeSingle()
    const fv = parseFloat(agg?.fattore_volume)
    if (fv > 0) fattore = fv
  }

  // UNA FUNZIONE SOLA, non una copia qui e una piu' giu'.
  // Il peso fatturato era ricalcolato a mano in TRE punti: qui (prezzo cliente), nel prezzo del
  // corriere piu' sotto, e in calcolaPesoFatturato — che pero' la usava un chiamante solo. Quando
  // si e' scoperto che il conto era diverso da quello del corriere, correggere la funzione
  // condivisa non avrebbe cambiato un solo prezzo: le due copie vive stavano qui.
  // "solo peso reale": ignora il volumetrico, si paga sempre sul peso reale.
  const _pf = calcolaPesoFatturato(packages, fattore, !!listino?.solo_peso_reale)
  const pesoReale = _pf.pesoReale || 1
  const pesoVolume = _pf.pesoVolume
  const pesoFatturato = _pf.pesoFatturato || pesoReale
  // agevolazione peso reale: valida solo se OGNI pacco e' entro 50x28x32 cm
  // La scatola dell'agevolazione dipende dal CONTRATTO: valutata per corriere piu' sotto.

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(id,nome), corrieri(id,tipo,nome_contratto,settings)')
    .eq('listino_id', listinoId)
    .order('peso_max', { ascending: true })

  if (!fasce?.length) return null

  // 1) Match via zone_cap (CAP esatto > provincia > jolly), ristretto alle zone del listino.
  //    Mappa zona->corriere: i tier si applicano PER CORRIERE (il CAP esatto di un corriere non
  //    deve escludere gli altri corrieri che coprono la destinazione a provincia/jolly).
  // Zone ESCLUSIVE del corriere (Zone Disagiate/Isole/Sardegna…) ANCHE se questo listino NON le
  // prezza: identico a tariffe/route. Servono a NON far cadere su "Italia"/"Sardegna" una
  // destinazione disagiata quando al cliente manca la fascia speciale → il corriere viene ESCLUSO
  // (niente vendita sotto costo). Senza questo, un CAP disagiato (es. 09038 in "Zone Disagiate")
  // ripiegava sulla fascia regionale (Sardegna) e si vendeva sotto costo.
  const corrIdsListino = Array.from(new Set<string>(fasce.map((f: any) => (f.corrieri as any)?.id).filter(Boolean)))
  const esclMaster = await zoneEsclusiveMaster(supabase, corrIdsListino, params.cap)
  const candidateZonaIds = Array.from(new Set<string>([
    ...fasce.map((f: any) => (f.zone as any)?.id).filter(Boolean),
    ...esclMaster.map((z) => z.id),
  ]))
  const zonaCorr = new Map<string, string>()
  for (const f of fasce) { const zid = (f.zone as any)?.id, cid = (f.corrieri as any)?.id; if (zid && cid) zonaCorr.set(zid, cid) }
  // Mappa zona_id -> corriere_id delle zone ESCLUSIVE: le fasce esclusive del listino + le zone
  // esclusive del MASTER (così l'esclusione scatta anche se il cliente non ha la fascia speciale).
  // L'esclusione dal jolly "Italia" è PER-CORRIERE (un CAP disagiato per BRT non tocca Poste).
  const esclCorr = new Map<string, string>()
  for (const f of fasce) { const zid = (f.zone as any)?.id, cid = (f.corrieri as any)?.id; if (zid && cid && isZonaEsclusiva((f.zone as any)?.nome)) esclCorr.set(zid, cid) }
  for (const z of esclMaster) esclCorr.set(z.id, z.corriere_id)
  const { ids: zoneMatchIds, corrieriEsclusi } = await trovaZoneMatchDett(
    supabase,
    { paese: params.paese, provincia, cap: params.cap, citta: (params as any).citta },
    candidateZonaIds,
    zonaCorr,
    esclCorr
  )
  // 2) Raggruppa per corriere; per OGNI corriere: match via zone_cap, poi fallback per nome "Italia"
  //    SOLO se la dest NON è esclusiva PER QUESTO corriere (per-corriere) e non è estero.
  const isEsteroL = (params.paese || 'IT').toUpperCase().trim() !== 'IT'
  const tuttePerCorr = new Map<string, any[]>()
  for (const f of fasce) {
    const cId = (f.corrieri as any)?.id
    if (!cId) continue
    if (!tuttePerCorr.has(cId)) tuttePerCorr.set(cId, [])
    tuttePerCorr.get(cId)!.push(f)
  }
  const fascePerCorriere = new Map<string, any[]>()
  for (const [cId, fasceC] of tuttePerCorr) {
    let sel = fasceC.filter((f: any) => zoneMatchIds.includes((f.zone as any)?.id))
    if (!sel.length && !isEsteroL && !corrieriEsclusi.has(cId)) {
      sel = fasceC.filter((f: any) => (f.zone as any)?.nome === zonaNome)
      if (!sel.length) sel = fasceC.filter((f: any) => (f.zone as any)?.nome === 'Italia')
    }
    if (sel.length) fascePerCorriere.set(cId, sel)
  }
  if (!fascePerCorriere.size) return null

  // Se è indicato un corriere preciso, usa quello; altrimenti scegli il prezzo più basso.
  // CORRIERE RICHIESTO ma NON disponibile qui (escluso: zona disagiata non prezzata al cliente,
  // o zona non coperta) -> NIENTE prezzo. MAI ripiegare sui contratti degli ALTRI corrieri:
  // si spedirebbe col corriere A al prezzo del corriere B (successo davvero via API v1: BRT in
  // zona disagiata prezzato con la fascia Poste 4,90 contro un costo reale di 12,38).
  if (params.corriereId && !fascePerCorriere.has(params.corriereId)) return null
  let miglior: { prezzo: number; corriereId: string; pesoMax: number } | null = null

  const entries = params.corriereId
    ? [[params.corriereId, fascePerCorriere.get(params.corriereId)!]] as [string, any[]][]
    : Array.from(fascePerCorriere.entries())

  for (const [cId, fasceDelCorriere] of entries) {
    const settsC = (fasceDelCorriere[0]?.corrieri as any)?.settings || {}
    // La regola sta in un posto solo: qui mancava la soglia "peso reale fino a X kg", e questo e'
    // il punto che decide quanto si paga davvero.
    const usaPesoReale = pesoSuReale(settsC, packages, pesoReale)
    const pesoPerFascia = usaPesoReale ? pesoReale : pesoFatturato
    const fascia = trovaFascia(fasceDelCorriere, pesoPerFascia)
    if (!fascia) continue
    const _fuelPct = Number((fascia as any).fuel) || 0
    const prezzo = Number(fascia.prezzo) * (1 + _fuelPct / 100)
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

  const zonaRisolta = (fascePerCorriere.get(miglior.corriereId)?.[0]?.zone as any)?.nome || zonaNome

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


// Calcola il prezzo che il MASTER paga al CORRIERE (listino corriere) per una spedizione,
// scorporato in voci. calcolaPrezzoCorriere (sotto) ne ritorna solo il totale (compat).
export async function calcolaPrezzoCorriereDettaglio(
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
    citta?: string   // città destinazione: distingue i CAP condivisi tra più comuni (zona disagiata vs Italia)
  }
): Promise<DettaglioCorriere | null> {
  const { corriereId, masterId, provincia } = params
  const zonaNome = zonaDaProvincia(provincia)

  // Le fasce del listino corriere possono essere salvate sotto uno qualsiasi dei
  // listini del master (l'editor usa un listino unico + corriere_id). Cerchiamo
  // quindi in TUTTI i listini del master, filtrando per corriere_id.
  const { data: listini } = await supabase
    .from('listini_corrieri')
    .select('id,corriere_id,fattore_volume,solo_peso_reale')
    .eq('master_id', masterId)
  if (!listini?.length) return null
  const listinoIds = listini.map((l: any) => l.id)
  // Fattore volume PER-CORRIERE: l'editor lo salva in listini_corrieri_corrieri (per corriere),
  // NON nel default del listino. Va letto da lì, altrimenti si conteggia 5000 anche se hai messo 4000.
  // Il listino da cui leggere il fattore e' SOLO quello legato a QUESTO corriere. Prima, se il
  // corriere non ne aveva uno, si ripiegava sul PRIMO listino del master — cioe' sul fattore di un
  // altro contratto. Velox ha dodici listini con fattori 3333, 4000 e 5000 e nessun ordinamento
  // garantito: il divisore di un contratto senza listino proprio usciva a caso fra quelli. Se non
  // c'e' niente di suo, si usa 5000, che e' il valore dichiarato di default — mai quello di un altro.
  // Un solo posto decide il divisore, con l'eredita' dalla catena (vedi fattoreVolumeCorriere).
  const fattore = await fattoreVolumeCorriere(supabase, masterId, corriereId)

  const soloPesoReale = listini.some((l: any) => l.solo_peso_reale)

  const packages = Array.isArray(params.packages) && params.packages.length ? params.packages : []
  // Stessa funzione del prezzo cliente (vedi la nota li' sopra): il peso fatturato si conta collo
  // per collo, come fa il corriere, e in un punto solo.
  const _pfm = calcolaPesoFatturato(packages, fattore, soloPesoReale)
  const pesoVolume = _pfm.pesoVolume
  // Il peso reale arriva dal chiamante e vince sul ricavato dai colli: c'e' chi passa il peso senza
  // il dettaglio dei colli, e in quel caso dai pacchi non si ricava niente.
  const pesoReale = Number(params.pesoReale) || _pfm.pesoReale || 1
  let pesoFatturato = soloPesoReale ? pesoReale : Math.max(_pfm.pesoFatturato, pesoReale)
  // Agevolazione peso reale: se il corriere ha il flag e OGNI collo è entro 50x32x28 cm,
  // si tassa sul peso reale (come nel preventivo cliente).
  const { data: corrSett } = await supabase.from('corrieri').select('settings').eq('id', corriereId).maybeSingle()
  const _sett: any = corrSett?.settings || {}
  if (pesoSuReale(_sett, packages, pesoReale, soloPesoReale)) pesoFatturato = pesoReale

  const { data: fasce } = await supabase
    .from('listini_corrieri_fasce')
    .select('*, zone(id,nome)')
    .in('listino_id', listinoIds)
    .eq('corriere_id', corriereId)
    .order('peso_max', { ascending: true })
  if (!fasce?.length) return null

  // Zone ESCLUSIVE del corriere (isole/disagiate/…), anche se questo listino NON le prezza: servono
  // a NON far cadere su "Italia" una destinazione esclusiva (es. 30126 disagiata) quando manca la
  // fascia speciale → il corriere semplicemente non copre quella destinazione (niente sotto-costo).
  const esclZone = await zoneEsclusiveMaster(supabase, [corriereId], params.cap)
  const esclCorr = new Map<string, string>()
  for (const z of esclZone) esclCorr.set(z.id, z.corriere_id)
  const zonaCorr = new Map<string, string>()
  const candidateZonaIds = Array.from(new Set<string>([...fasce.map((f: any) => (f.zone as any)?.id).filter(Boolean), ...esclZone.map((z) => z.id)]))
  for (const f of fasce) { const zid = (f.zone as any)?.id; if (zid) zonaCorr.set(zid, corriereId) }
  const { ids: zoneMatchIds, corrieriEsclusi } = await trovaZoneMatchDett(
    supabase,
    { paese: params.paese, provincia, cap: params.cap, citta: (params as any).citta },
    candidateZonaIds, zonaCorr, esclCorr
  )
  let fasceZona = zoneMatchIds.length ? fasce.filter((f: any) => zoneMatchIds.includes((f.zone as any)?.id)) : []
  // Per l'ESTERO niente fallback su Italia; e nemmeno se la dest è ESCLUSIVA per questo corriere.
  const isEsteroC = (params.paese || 'IT').toUpperCase().trim() !== 'IT'
  if (!isEsteroC && !corrieriEsclusi.has(corriereId)) {
    if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === zonaNome)
    if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === 'Italia')
  }
  if (!fasceZona.length) return null

  const finoA = fasceZona.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => a.peso_max - b.peso_max)
  const oltre = fasceZona.find((f: any) => f.tipo === 'oltre')
  let prezzo = 0
  let trovata = false
  let fuelPct = 0
  for (const f of finoA) {
    if (pesoFatturato <= parseFloat(f.peso_max)) { prezzo = parseFloat(f.prezzo); fuelPct = Number(f.fuel) || 0; trovata = true; break }
  }
  if (!trovata) {
    if (oltre && finoA.length) {
      const ultima = finoA[finoA.length - 1]
      const kgExtra = pesoFatturato - parseFloat(ultima.peso_max)
      prezzo = parseFloat(ultima.prezzo) + Math.ceil(kgExtra / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
      fuelPct = Number(ultima.fuel) || 0
    } else return null   // peso oltre l'ultima fascia e nessuna "oltre": nessun prezzo
  }
  // Fuel %: supplemento percentuale sul nolo di fascia (scorporato).
  const noloBase = prezzo
  const fuelAmt = fuelPct ? noloBase * (fuelPct / 100) : 0

  // ORDINE per id: con supplementi duplicati (piu' listini corrieri per lo stesso contratto) gli
  // scaglioni con lo STESSO valore_max restavano nell'ordine casuale del database -> la commissione
  // contrassegno/assicurazione poteva cambiare tra una chiamata e l'altra. Ora la scelta e' stabile.
  const { data: suppl } = await supabase
    .from('listini_corrieri_supplementi')
    .select('tipo,valore,tipo_calcolo,descrizione')
    .in('listino_id', listinoIds)
    .eq('corriere_id', corriereId)
    .order('id', { ascending: true })

  const cod = Number(params.contrassegno) || 0
  const ass = Number(params.assicurazione) || 0

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
  // Sponda: sopra soglia_kg, +prezzo_kg € per ogni kg (peso fatturato).
  let spondaAmt = 0
  const spondaRow = (suppl || []).find((s: any) => s.tipo === 'sponda')
  if (spondaRow) {
    let d: any = null; try { d = JSON.parse(spondaRow.descrizione) } catch {}
    const soglia = Number(d?.soglia_kg) || 0
    const prezzoKg = Number(spondaRow.valore) || 0
    if (soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia) spondaAmt = pesoFatturato * prezzoKg
  }
  const feeCod = applicaScaglione('contrassegno', cod)
  const feeAss = applicaScaglione('assicurazione', ass)

  // Massimo valore ammesso per tipo (il valore_max più alto tra gli scaglioni configurati).
  // Servizio "presente" SOLO se ha almeno uno scaglione con valore_max > 0 (regola uniforme:
  // valore_max 0/vuoto = scaglione inesistente/non valido).
  function maxScaglione(tipo: string): { presente: boolean; max: number } {
    const scal = (suppl || []).filter((s: any) => s.tipo === tipo)
    let max = 0
    for (const s of scal) { let d: any = null; try { d = JSON.parse(s.descrizione) } catch {}; const v = parseFloat(d?.valore_max ?? '') || 0; if (v > max) max = v }
    return { presente: max > 0, max }
  }
  // Contrassegno: se richiesto ma senza tariffa OPPURE oltre il max -> corriere non disponibile.
  const scC = maxScaglione('contrassegno')
  const contrassegnoOltreMax = cod > 0 && (!scC.presente || cod > scC.max)
  // Assicurazione: STESSA regola del contrassegno — se richiesta ma il servizio non esiste
  // (nessuno scaglione valido) OPPURE l'importo supera il max -> corriere non disponibile.
  const scA = maxScaglione('assicurazione')
  const assicurazioneOltreMax = ass > 0 && (!scA.presente || ass > scA.max)

  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    totale: r2(noloBase + fuelAmt + spondaAmt + feeCod + feeAss),
    nolo: r2(noloBase),
    fuel: r2(fuelAmt),
    sponda: r2(spondaAmt),
    contrassegno: r2(feeCod),
    assicurazione: r2(feeAss),
    peso_reale: r2(pesoReale),
    peso_volume: r2(pesoVolume),
    peso_fatturato: r2(pesoFatturato),
    contrassegnoOltreMax,
    assicurazioneOltreMax,
    // La zona che ha vinto davvero: quella delle fasce scelte, non quella dedotta dalla provincia.
    zona: (fasceZona[0] as any)?.zone?.nome || zonaNome,
  }
}

// Compat: ritorna solo il totale del listino corriere (usato da cascata, report, ecc.).
export async function calcolaPrezzoCorriere(
  supabase: any,
  params: {
    corriereId: string; masterId: string; provincia: string; pesoReale: number
    packages?: any[]; contrassegno?: number; assicurazione?: number; cap?: string; paese?: string
    // `citta` mancava QUI ma esiste (ed e' usata) in calcolaPrezzoCorriereDettaglio: i chiamanti la
    // passavano e TypeScript la segnalava come proprieta' sconosciuta. Serve a distinguere i CAP
    // condivisi fra piu' comuni — stesso CAP, uno normale e uno in zona disagiata: senza citta' il
    // costo di catena poteva agganciare la zona sbagliata, cioe' addebitare un importo diverso da
    // quello calcolato per il cliente.
    citta?: string
  }
): Promise<number | null> {
  const d = await calcolaPrezzoCorriereDettaglio(supabase, params)
  return d ? d.totale : null
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
    // Solo scaglioni validi (valore_max > 0): 0/vuoto = inesistente.
    const scal = scaglioni(tipo).filter((x: any) => x.valore_max > 0)
    if (!scal.length) return null   // servizio richiesto ma non configurato -> contratto non disponibile
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
  const listinoIds: string[] = (listini || []).map((l: any) => l.id)
  // Fattore volume PER-CORRIERE: override salvato in listini_corrieri_corrieri (non nel default del listino).
  const { data: aggFv } = listinoIds.length
    ? await supabase.from('listini_corrieri_corrieri').select('corriere_id,fattore_volume').in('listino_id', listinoIds)
    : { data: [] }
  const overridePerCorr = new Map<string, number>()
  for (const a of aggFv || []) { const fv = parseFloat(a?.fattore_volume); if (a?.corriere_id && fv > 0) overridePerCorr.set(a.corriere_id, fv) }
  const listinoPerCorriere = new Map<string, { id: string; fattore: number }>()
  for (const l of listini || []) {
    const fattore = overridePerCorr.get(l.corriere_id) || parseFloat(l.fattore_volume) || 5000
    listinoPerCorriere.set(l.corriere_id, { id: l.id, fattore })
  }

  // fetchAll: fasce e zone_cap possono superare le 1000 righe (limite PostgREST) — prima venivano
  // TRONCATE e il fallback prezzava con zone/fasce incomplete (margine sbagliato sui CAP oltre i primi 1000).
  const fasce: any[] = listinoIds.length
    ? await fetchAll(() => supabase.from('listini_corrieri_fasce').select('listino_id,peso_max,prezzo,tipo,zona_id,fuel,zone(id,nome)').in('listino_id', listinoIds))
    : []
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
  const zc: any[] = zonaIds.length
    ? await fetchAll(() => supabase.from('zone_cap').select('zona_id,paese,provincia,cap,citta').in('zona_id', zonaIds))
    : []
  const zcByPaese = new Map<string, any[]>()
  for (const r of zc || []) {
    const k = (r.paese || '').toUpperCase()
    if (!zcByPaese.has(k)) zcByPaese.set(k, [])
    zcByPaese.get(k)!.push(r)
  }

  function matchZona(paese: string, provincia: string, cap: string, cand: string[], citta?: string): string[] {
    let rows = (zcByPaese.get((paese || 'IT').toUpperCase()) || []).filter((r: any) => cand.includes(r.zona_id))
    rows = filtraCapCondiviso(rows, cap, citta)   // CAP condivisi: la riga di un ALTRO comune non aggancia
    let m = rows.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
    // Una riga che nomina un COMUNE vale solo per quel comune (vedi rigaValePerCitta in zone-match):
    // senza questo, "VE/*/BURANO" prezzava come isola minore tutta la provincia di Venezia.
    if (!m.length) m = rows.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*') && rigaValePerCitta(r, citta))
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
    const ids = matchZona(paese, provincia, cap, cand, s.dest_citta)
    const zonaNome = zonaDaProvincia(provincia)
    let fz = ids.length ? fasceList.filter((f: any) => ids.includes(f.zone?.id)) : []
    // Per l'ESTERO niente fallback su Italia.
    if (paese === 'IT') {
      if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === zonaNome)
      if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === 'Italia')
    }
    if (!fz.length) return null

    const finoA = fz.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => a.peso_max - b.peso_max)
    const oltre = fz.find((f: any) => f.tipo === 'oltre')
    let prezzo = 0, trovata = false, fuelPct = 0
    for (const f of finoA) { if (pesoFatturato <= parseFloat(f.peso_max)) { prezzo = parseFloat(f.prezzo); fuelPct = Number(f.fuel) || 0; trovata = true; break } }
    if (!trovata) {
      if (oltre && finoA.length) {
        const u = finoA[finoA.length - 1]
        prezzo = parseFloat(u.prezzo) + Math.ceil((pesoFatturato - parseFloat(u.peso_max)) / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
        fuelPct = Number(u.fuel) || 0
      } else return null   // peso oltre l'ultima fascia e nessuna "oltre": nessun prezzo
    }
    if (fuelPct) prezzo = prezzo * (1 + fuelPct / 100)

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
  // Fattore volume PER-CORRIERE (override del default del listino): stesso comportamento del
  // listino corriere, così il peso fatturato coincide (altrimenti il report mostra margini falsati).
  const { data: aggCorr } = await supabase.from('listini_clienti_corrieri').select('corriere_id,fattore_volume').eq('listino_id', listinoId)
  const fattorePerCorr = new Map<string, number>()
  for (const a of (aggCorr || [])) { const fv = parseFloat(a?.fattore_volume); if (a?.corriere_id && fv > 0) fattorePerCorr.set(a.corriere_id, fv) }

  // fetchAll: oltre 1000 fasce venivano TRONCATE (limite PostgREST) → prezzi fallback incompleti.
  const fasce: any[] = await fetchAll(() => supabase
    .from('listini_clienti_fasce').select('corriere_id,zona_id,peso_max,prezzo,tipo,fuel,zone(id,nome)')
    .eq('listino_id', listinoId))
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

  // Impostazioni corriere (agevolazione peso reale + "peso reale fino a X kg"): il peso fatturato
  // deve seguire la STESSA logica del preventivo, altrimenti il costo cade in una fascia diversa.
  const corrIdsL = Array.from(fascePerCorriere.keys())
  const { data: corrSettL } = corrIdsL.length
    ? await supabase.from('corrieri').select('id,settings').in('id', corrIdsL)
    : { data: [] }
  const settPerCorrL = new Map<string, any>()
  for (const c of (corrSettL || [])) settPerCorrL.set(c.id, (c as any).settings || {})

  const zonaIds = Array.from(new Set((fasce || []).map((f: any) => f.zone?.id).filter(Boolean)))
  const zc: any[] = zonaIds.length
    ? await fetchAll(() => supabase.from('zone_cap').select('zona_id,paese,provincia,cap,citta').in('zona_id', zonaIds))
    : []
  const zcByPaese = new Map<string, any[]>()
  for (const r of zc || []) {
    const k = (r.paese || '').toUpperCase()
    if (!zcByPaese.has(k)) zcByPaese.set(k, [])
    zcByPaese.get(k)!.push(r)
  }
  function matchZona(paese: string, provincia: string, cap: string, cand: string[], citta?: string): string[] {
    let rows = (zcByPaese.get((paese || 'IT').toUpperCase()) || []).filter((r: any) => cand.includes(r.zona_id))
    rows = filtraCapCondiviso(rows, cap, citta)   // CAP condivisi: la riga di un ALTRO comune non aggancia
    let m = rows.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
    // Una riga che nomina un COMUNE vale solo per quel comune (vedi rigaValePerCitta in zone-match):
    // senza questo, "VE/*/BURANO" prezzava come isola minore tutta la provincia di Venezia.
    if (!m.length) m = rows.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*') && rigaValePerCitta(r, citta))
    if (!m.length) m = rows.filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))
    return Array.from(new Set(m.map((r: any) => r.zona_id)))
  }

  return function prezzoListinoRow(s: any): DettaglioPrezzo | null {
    const fasceList = fascePerCorriere.get(s.corriere_id) || []
    if (!fasceList.length) return null

    const L = Number(s.lunghezza) || 0, W = Number(s.larghezza) || 0, H = Number(s.altezza) || 0
    const fattoreC = fattorePerCorr.get(s.corriere_id) || fattore   // per-corriere, fallback default

    // TUTTI I COLLI, non solo il primo.
    //
    // Qui si leggevano solo lunghezza/larghezza/altezza della spedizione, che sono le misure di UN
    // collo: su un multicollo il volumetrico usciva diviso per il numero dei colli. Su una
    // spedizione vera da 5 colli il peso fatturato risultava 14 kg invece di 79,6 — cioe' una
    // fascia di prezzo molto piu' bassa, e un margine gonfiato di conseguenza.
    // Le misure dei singoli colli stanno in colli_dettaglio; se manca (spedizioni vecchie) si
    // ripiega sulla misura unica ripetuta per il numero di colli, che e' come e' stata creata.
    const nColli = Math.max(1, Number(s.colli) || 1)
    const dett = Array.isArray(s.colli_dettaglio) ? s.colli_dettaglio : []
    const pacchi = dett.length
      ? dett.map((c: any) => ({
          length: Number(c?.lunghezza ?? c?.length) || 0,
          width: Number(c?.larghezza ?? c?.width) || 0,
          height: Number(c?.altezza ?? c?.height) || 0,
          weight: Number(c?.peso ?? c?.weight) || 0,
        }))
      : Array.from({ length: nColli }, () => ({ length: L, width: W, height: H, weight: 0 }))

    const pesoVolume = pacchi.reduce((t: number, p: any) =>
      t + ((p.length && p.width && p.height) ? (p.length * p.width * p.height) / fattoreC : 0), 0)
    // Peso reale: la somma dei colli quando i singoli pesi ci sono (stessa regola del preventivo),
    // altrimenti quello scritto sulla spedizione.
    const sommaPesi = pacchi.reduce((t: number, p: any) => t + (Number(p.weight) || 0), 0)
    const pesoReale = sommaPesi > 0 ? sommaPesi : (Number(s.peso_reale) || 1)
    // Agevolazione peso reale (come il preventivo): se il corriere ha il flag e il collo è entro
    // 50×32×28 cm, oppure "peso reale fino a X kg" sotto soglia, si tassa sul PESO REALE.
    const settC = settPerCorrL.get(s.corriere_id) || {}
    const usaReale = pesoSuReale(settC, pacchi, pesoReale, soloPesoReale)
    const pesoFatturato = usaReale ? pesoReale : Math.max(pesoReale, pesoVolume)

    const provincia = (s.dest_provincia || '').toUpperCase().trim()
    const cap = (s.dest_cap || '').trim()
    const paese = (s.dest_paese || 'IT').toUpperCase().trim()
    const cand = fasceList.map((f: any) => f.zone?.id).filter(Boolean)
    const ids = matchZona(paese, provincia, cap, cand, s.dest_citta)
    const zonaNome = zonaDaProvincia(provincia)
    let fz = ids.length ? fasceList.filter((f: any) => ids.includes(f.zone?.id)) : []
    // Per l'ESTERO niente fallback su Italia.
    if (paese === 'IT') {
      if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === zonaNome)
      if (!fz.length) fz = fasceList.filter((f: any) => f.zone?.nome === 'Italia')
    }
    if (!fz.length) return null

    const finoA = fz.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => a.peso_max - b.peso_max)
    const oltre = fz.find((f: any) => f.tipo === 'oltre')
    let prezzo = 0, trovata = false, fuelPct = 0
    for (const f of finoA) { if (pesoFatturato <= parseFloat(f.peso_max)) { prezzo = parseFloat(f.prezzo); fuelPct = Number(f.fuel) || 0; trovata = true; break } }
    if (!trovata) {
      if (oltre && finoA.length) {
        const u = finoA[finoA.length - 1]
        prezzo = parseFloat(u.prezzo) + Math.ceil((pesoFatturato - parseFloat(u.peso_max)) / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
        fuelPct = Number(u.fuel) || 0
      } else return null   // peso oltre l'ultima fascia e nessuna "oltre": nessun prezzo
    }
    if (fuelPct) prezzo = prezzo * (1 + fuelPct / 100)

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