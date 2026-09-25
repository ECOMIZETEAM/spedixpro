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

// SUPPLEMENTO ORIGINE ("zona mittente disagiato").
//
// Alcuni corrieri fanno pagare di piu' quando il pacco PARTE da certe aree (Sicilia, Sardegna,
// Calabria, isole, comuni remoti): e' un costo reale che dipende dal MITTENTE, non dalla
// destinazione. Il listino nasce tutto sulla destinazione, quindi questo costo, se non lo si
// aggiunge, lo assorbe il detentore in silenzio (BRT da Sicilia +2,71; UPS da Basilicata +1,77,
// misurati sui costi reali). Lo modelliamo come una ZONA marcata `su_mittente`: i suoi CAP/province
// sono di PARTENZA e le sue fasce sono il supplemento (piatto o per peso). Il match e' additivo,
// senza esclusione (a differenza delle zone speciali di destinazione): o c'e' il supplemento o e' 0.
//
// SICUREZZA: finche' non esiste NESSUNA zona `su_mittente` (o il mittente non ci cade), torna 0 →
// il prezzo e' identico a prima. Nessuna spedizione cambia finche' non si configurano le zone.
//
// `fasce` sono gia' quelle caricate dal chiamante (listino corriere O cliente), ognuna con
// `zone(id,su_mittente)`. Cosi' il supplemento del livello esce dallo STESSO listino del suo prezzo.
export async function supplementoMittente(
  supabase: any,
  fasce: any[],
  mitt: { cap?: string; provincia?: string; paese?: string } | undefined,
  pesoFatturato: number,
  // NO-STACKING: se la DESTINAZIONE è già nella STESSA zona-mittente (stessa regione surchargata),
  // il fornitore applica il supplemento UNA volta sola — la fascia di destinazione (es. "Sicilia")
  // già lo contiene, quindi NON si somma anche l'origine. Verificato su DVA: Sicilia→isola-siciliana
  // costa 6,67 (una volta), non 6,78+1,36. Senza `dest`, comportamento invariato (nessun controllo).
  dest?: { cap?: string; provincia?: string; paese?: string }
): Promise<number> {
  if (!mitt?.cap && !mitt?.provincia) return 0
  const origIds = Array.from(new Set(
    (fasce || []).filter((f: any) => (f.zone as any)?.su_mittente).map((f: any) => (f.zone as any)?.id).filter(Boolean)
  ))
  if (!origIds.length) return 0
  const paese = (mitt.paese || 'IT').toUpperCase().trim()
  const cap = (mitt.cap || '').trim()
  const prov = (mitt.provincia || '').toUpperCase().trim()
  // Match sul MITTENTE: CAP esatto > provincia (cap jolly) > jolly totale. Nessuna esclusione.
  const { data: zc } = await supabase
    .from('zone_cap').select('zona_id,provincia,cap').eq('paese', paese)
    .in('zona_id', origIds).in('cap', Array.from(new Set([cap, '*'].filter(Boolean))))
  let m = (zc || []).filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
  if (!m.length) m = (zc || []).filter((r: any) => r.provincia && r.provincia !== '*' && String(r.provincia).toUpperCase() === prov && (!r.cap || r.cap === '*'))
  if (!m.length) m = (zc || []).filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))
  if (!m.length) return 0
  const zoneMatch = new Set(m.map((r: any) => r.zona_id))

  // NO-STACKING: la destinazione cade nella STESSA zona-mittente? Allora il supplemento regionale è
  // già nel prezzo di destinazione → non lo si aggiunge di nuovo (una volta sola, come fa il fornitore).
  if (dest?.cap || dest?.provincia) {
    const dPaese = (dest.paese || 'IT').toUpperCase().trim()
    const dCap = (dest.cap || '').trim()
    const dProv = (dest.provincia || '').toUpperCase().trim()
    const { data: zcD } = await supabase
      .from('zone_cap').select('zona_id,provincia,cap').eq('paese', dPaese)
      .in('zona_id', Array.from(zoneMatch)).in('cap', Array.from(new Set([dCap, '*'].filter(Boolean))))
    const destInStessaZona = (zcD || []).some((r: any) =>
      (r.cap && r.cap !== '*' && r.cap === dCap) ||
      (r.provincia && r.provincia !== '*' && String(r.provincia).toUpperCase() === dProv && (!r.cap || r.cap === '*')))
    if (destInStessaZona) return 0
  }

  const origFasce = (fasce || []).filter((f: any) => zoneMatch.has((f.zone as any)?.id))
  const f = trovaFascia(origFasce, pesoFatturato)   // a parita' di scaglione vince il piu' alto
  return f ? Number((f as any).prezzo) || 0 : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAGLIONI SUPPLEMENTO (contrassegno / assicurazione) — UNA logica sola.
//
// Prima questo blocco era COPIATO in ~6 rami (calcolaPrezzoCorriereDettaglio, i due calcolatori
// batch, calcolaSupplementiCliente, tariffe-motore): al primo ritocco divergevano. Ora sta qui.
//
// descrizione = { valore_max, prezzo_fisso, perc, calcolo_su, peso_min?, peso_max? }.
// peso_min/peso_max (kg, sul PESO REALE) = banda di peso in cui lo scaglione vale. Serve perché la
// commissione contrassegno di alcuni corrieri DIPENDE DAL PESO: VERIFICATO 24/09 su BRT (via
// SpediamoPro), peso reale ≤5kg = servizio "small" (commissione fissa €1,97 a qualsiasi COD),
// >5kg = servizio pesante (fisso fino a €1.000, poi 1%). Con un solo scaglione per valore non si
// poteva esprimere: il €1,97 fisso perdeva sui pacchi pesanti con COD alto (>€1.000).
// Gli scaglioni SENZA peso valgono per TUTTI i pesi → i listini esistenti non cambiano.
export type ScaglioneSupp = { valore_max: number; prezzo_fisso: number; perc: number; calcolo_su: string; peso_min: number | null; peso_max: number | null }

export function parseScaglioniSupp(suppl: any[], tipo: string): ScaglioneSupp[] {
  return (suppl || []).filter((s: any) => s.tipo === tipo).map((s: any) => {
    let d: any = null; try { d = JSON.parse(s.descrizione) } catch {}
    const pmin = d?.peso_min, pmax = d?.peso_max
    return {
      valore_max: parseFloat(d?.valore_max ?? '') || 0,
      prezzo_fisso: parseFloat(d?.prezzo_fisso ?? s.valore ?? '') || 0,
      perc: parseFloat(d?.perc ?? '') || 0,
      calcolo_su: d?.calcolo_su || s.tipo_calcolo || 'totale',
      peso_min: (pmin === '' || pmin == null) ? null : (parseFloat(pmin) || 0),
      peso_max: (pmax === '' || pmax == null) ? null : (parseFloat(pmax) || 0),
    }
  })
}

// Sceglie gli scaglioni applicabili al PESO REALE. Nessuna banda peso configurata (o peso non noto)
// → valgono tutti (comportamento storico). Se una banda contiene il peso si usa quella; se nessuna
// banda lo contiene si ripiega sugli scaglioni SENZA peso (universali). Banda = (peso_min, peso_max].
export function scaglioniPerPeso(scal: ScaglioneSupp[], pesoReale?: number | null): ScaglioneSupp[] {
  const conPeso = scal.filter(s => s.peso_min != null || s.peso_max != null)
  if (!conPeso.length || pesoReale == null) return scal
  const p = Number(pesoReale)
  const match = scal.filter(s => (s.peso_min == null || p > s.peso_min + 1e-9) && (s.peso_max == null || p <= s.peso_max + 1e-9))
  return match.length ? match : scal.filter(s => s.peso_min == null && s.peso_max == null)
}

// Commissione supplemento (fee). Ritorna 0 se non configurato. `soloValidi` scarta gli scaglioni con
// valore_max 0 (regola del ramo cliente: 0/vuoto = inesistente).
export function commissioneSupp(suppl: any[], tipo: string, importo: number, pesoReale?: number | null, soloValidi = false): number {
  if (!(importo > 0)) return 0
  let scal = scaglioniPerPeso(parseScaglioniSupp(suppl, tipo), pesoReale)
  if (soloValidi) scal = scal.filter(s => s.valore_max > 0)
  scal = scal.sort((a, b) => a.valore_max - b.valore_max)
  if (!scal.length) return 0
  const s = scal.find(x => importo <= x.valore_max) || scal[scal.length - 1]
  const primaFasciaMax = Number(scal[0]?.valore_max) || 0
  const base = s.calcolo_su === 'differenza' ? Math.max(0, importo - primaFasciaMax) : importo
  return s.prezzo_fisso + (s.perc / 100) * base
}

// Presente/max per un tipo, ristretto alla banda di peso (serve al gate "COD/assic oltre il max → escludi").
export function supplPresenteMax(suppl: any[], tipo: string, pesoReale?: number | null): { presente: boolean; max: number } {
  const scal = scaglioniPerPeso(parseScaglioniSupp(suppl, tipo), pesoReale)
  let max = 0; for (const s of scal) if (s.valore_max > max) max = s.valore_max
  return { presente: max > 0, max }
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
  mittente?: number        // supplemento ORIGINE (zona mittente disagiato); 0 se non configurato
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
    // SOLO ricalcolo RETTIFICHE: forza la fascia di UNA zona (di norma 'Italia'), bypassando il match
    // per CAP e l'esclusione zona-disagiata. Serve a rettificare su una fascia UNICA e coerente per
    // tutta la catena. Default assente = comportamento normale (la creazione NON lo passa mai).
    zonaForzata?: string
    // MITTENTE (partenza): per il supplemento "zona mittente disagiato". Assente = nessun supplemento.
    mittCap?: string
    mittProvincia?: string
    mittPaese?: string
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
    .select('*, zone(id,nome,su_mittente), corrieri(id,tipo,nome_contratto,settings)')
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
  // Le zone MITTENTE (su_mittente) hanno CAP di PARTENZA: fuori dal match destinazione. Il loro
  // supplemento si calcola a parte, sul mittente, dopo aver scelto il corriere.
  const isMittL = (zid: string | undefined) => !!zid && (fasce as any[]).some((f: any) => (f.zone as any)?.id === zid && (f.zone as any)?.su_mittente)
  const corrIdsListino = Array.from(new Set<string>(fasce.map((f: any) => (f.corrieri as any)?.id).filter(Boolean)))
  const esclMaster = (await zoneEsclusiveMaster(supabase, corrIdsListino, params.cap)).filter((z: any) => !isMittL(z.id))
  const candidateZonaIds = Array.from(new Set<string>([
    ...fasce.filter((f: any) => !(f.zone as any)?.su_mittente).map((f: any) => (f.zone as any)?.id).filter(Boolean),
    ...esclMaster.map((z) => z.id),
  ]))
  const zonaCorr = new Map<string, string>()
  for (const f of fasce) { const zid = (f.zone as any)?.id, cid = (f.corrieri as any)?.id; if (zid && cid && !(f.zone as any)?.su_mittente) zonaCorr.set(zid, cid) }
  // Mappa zona_id -> corriere_id delle zone ESCLUSIVE: le fasce esclusive del listino + le zone
  // esclusive del MASTER (così l'esclusione scatta anche se il cliente non ha la fascia speciale).
  // L'esclusione dal jolly "Italia" è PER-CORRIERE (un CAP disagiato per BRT non tocca Poste).
  const esclCorr = new Map<string, string>()
  for (const f of fasce) { const zid = (f.zone as any)?.id, cid = (f.corrieri as any)?.id; if (zid && cid && !(f.zone as any)?.su_mittente && isZonaEsclusiva((f.zone as any)?.nome)) esclCorr.set(zid, cid) }
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
    if ((f.zone as any)?.su_mittente) continue   // fasce ORIGINE: non sono prezzo destinazione
    if (!tuttePerCorr.has(cId)) tuttePerCorr.set(cId, [])
    tuttePerCorr.get(cId)!.push(f)
  }
  const fascePerCorriere = new Map<string, any[]>()
  for (const [cId, fasceC] of tuttePerCorr) {
    let sel: any[]
    if (params.zonaForzata) {
      // RICALCOLO RETTIFICHE: fascia forzata su UNA zona (di norma 'Italia'), stessa per tutti i livelli.
      // Si bypassa il match per CAP e l'esclusione zona-disagiata: qui non si sta VENDENDO (dove
      // l'esclusione evita di vendere sotto costo), si rettifica a posteriori su una fascia coerente.
      // Se la zona forzata non c'è nel listino, ripiega su 'Italia'.
      sel = fasceC.filter((f: any) => (f.zone as any)?.nome === params.zonaForzata)
      if (!sel.length && params.zonaForzata !== 'Italia') sel = fasceC.filter((f: any) => (f.zone as any)?.nome === 'Italia')
    } else {
      sel = fasceC.filter((f: any) => zoneMatchIds.includes((f.zone as any)?.id))
      if (!sel.length && !isEsteroL && !corrieriEsclusi.has(cId)) {
        sel = fasceC.filter((f: any) => (f.zone as any)?.nome === zonaNome)
        if (!sel.length) sel = fasceC.filter((f: any) => (f.zone as any)?.nome === 'Italia')
      }
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

  // SUPPLEMENTO ORIGINE (zona mittente disagiato) del corriere scelto. 0 se non configurato.
  const mittAmt = await supplementoMittente(
    supabase,
    fasce.filter((f: any) => (f.corrieri as any)?.id === miglior!.corriereId),
    { cap: params.mittCap, provincia: params.mittProvincia, paese: params.mittPaese },
    pesoFatturato,
    { cap: params.cap, provincia, paese: params.paese }   // no-stacking se dest è nella stessa regione
  )

  return {
    prezzo: Math.round((miglior.prezzo + sponda + mittAmt) * 100) / 100,
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
    // SOLO ricalcolo RETTIFICHE: come in calcolaPrezzoListino — forza la fascia di UNA zona (di norma
    // 'Italia') per tutti i livelli, bypassando match CAP + esclusione. Default assente = normale.
    zonaForzata?: string
    // SOLO cascata costi (costruisciCatena): la scelta reale/volumetrico del COSTO di un livello la
    // decide il FORNITORE (il livello sopra che gli vende il contratto), non questo livello. Quando è
    // passato, sostituisce del tutto la valutazione locale dell'agevolazione (settings + solo_peso_reale).
    // Il divisore volumetrico resta comunque il SUO (fattore per-corriere). Default assente = normale.
    pesoSuRealeCost?: boolean
    // MITTENTE (partenza): per il supplemento "zona mittente disagiato". Assente = nessun supplemento.
    mittCap?: string
    mittProvincia?: string
    mittPaese?: string
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
  let pesoFatturato: number
  if (params.pesoSuRealeCost !== undefined) {
    // COSTO IN CASCATA: reale/volumetrico lo decide il FORNITORE (regola Moove). Il flag di QUESTO
    // livello (settings + solo_peso_reale) vale solo per cosa regala ai suoi clienti, non per il suo
    // costo. Il divisore volumetrico resta il suo (fattore per-corriere → pesoVolume qui sopra).
    pesoFatturato = params.pesoSuRealeCost ? pesoReale : Math.max(pesoVolume, pesoReale)
  } else {
    pesoFatturato = soloPesoReale ? pesoReale : Math.max(_pfm.pesoFatturato, pesoReale)
    // Agevolazione peso reale: se il corriere ha il flag e OGNI collo è entro 50x32x28 cm,
    // si tassa sul peso reale (come nel preventivo cliente).
    const { data: corrSett } = await supabase.from('corrieri').select('settings').eq('id', corriereId).maybeSingle()
    const _sett: any = corrSett?.settings || {}
    if (pesoSuReale(_sett, packages, pesoReale, soloPesoReale)) pesoFatturato = pesoReale
  }

  const { data: fasce } = await supabase
    .from('listini_corrieri_fasce')
    .select('*, zone(id,nome,su_mittente)')
    .in('listino_id', listinoIds)
    .eq('corriere_id', corriereId)
    .order('peso_max', { ascending: true })
  if (!fasce?.length) return null

  // Le zone MITTENTE (su_mittente) non c'entrano con la destinazione: i loro CAP sono di PARTENZA.
  // Vanno tenute fuori dal match destinazione, altrimenti una spedizione DIRETTA a un CAP che sta
  // in una zona mittente prenderebbe quel supplemento come prezzo di zona. Il supplemento origine si
  // calcola a parte, sul mittente, più sotto.
  const isMitt = (zid: string | undefined) => !!zid && (fasce as any[]).some((f: any) => (f.zone as any)?.id === zid && (f.zone as any)?.su_mittente)

  // Zone ESCLUSIVE del corriere (isole/disagiate/…), anche se questo listino NON le prezza: servono
  // a NON far cadere su "Italia" una destinazione esclusiva (es. 30126 disagiata) quando manca la
  // fascia speciale → il corriere semplicemente non copre quella destinazione (niente sotto-costo).
  const esclZone = (await zoneEsclusiveMaster(supabase, [corriereId], params.cap)).filter((z: any) => !isMitt(z.id))
  const esclCorr = new Map<string, string>()
  for (const z of esclZone) esclCorr.set(z.id, z.corriere_id)
  const zonaCorr = new Map<string, string>()
  const candidateZonaIds = Array.from(new Set<string>([...fasce.filter((f: any) => !(f.zone as any)?.su_mittente).map((f: any) => (f.zone as any)?.id).filter(Boolean), ...esclZone.map((z) => z.id)]))
  for (const f of fasce) { const zid = (f.zone as any)?.id; if (zid && !(f.zone as any)?.su_mittente) zonaCorr.set(zid, corriereId) }
  const { ids: zoneMatchIds, corrieriEsclusi } = await trovaZoneMatchDett(
    supabase,
    { paese: params.paese, provincia, cap: params.cap, citta: (params as any).citta },
    candidateZonaIds, zonaCorr, esclCorr
  )
  let fasceZona: any[]
  if (params.zonaForzata) {
    // RICALCOLO RETTIFICHE: fascia forzata su UNA zona coerente per tutta la catena (di norma 'Italia'),
    // bypassando match CAP + esclusione. Ripiega su 'Italia' se la zona forzata non c'è in questo listino.
    fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === params.zonaForzata)
    if (!fasceZona.length && params.zonaForzata !== 'Italia') fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === 'Italia')
  } else {
    fasceZona = zoneMatchIds.length ? fasce.filter((f: any) => zoneMatchIds.includes((f.zone as any)?.id)) : []
    // Per l'ESTERO niente fallback su Italia; e nemmeno se la dest è ESCLUSIVA per questo corriere.
    const isEsteroC = (params.paese || 'IT').toUpperCase().trim() !== 'IT'
    if (!isEsteroC && !corrieriEsclusi.has(corriereId)) {
      if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === zonaNome)
      if (!fasceZona.length) fasceZona = fasce.filter((f: any) => (f.zone as any)?.nome === 'Italia')
    }
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

  // Scaglioni contrassegno/assicurazione: logica UNICA in commissioneSupp (con banda-peso).
  // Sponda: sopra soglia_kg, +prezzo_kg € per ogni kg (peso fatturato).
  let spondaAmt = 0
  const spondaRow = (suppl || []).find((s: any) => s.tipo === 'sponda')
  if (spondaRow) {
    let d: any = null; try { d = JSON.parse(spondaRow.descrizione) } catch {}
    const soglia = Number(d?.soglia_kg) || 0
    const prezzoKg = Number(spondaRow.valore) || 0
    if (soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia) spondaAmt = pesoFatturato * prezzoKg
  }
  // COMMISSIONE sul PESO REALE: la banda-peso del contrassegno la sceglie il peso reale (vedi commissioneSupp).
  const feeCod = commissioneSupp(suppl || [], 'contrassegno', cod, pesoReale)
  const feeAss = commissioneSupp(suppl || [], 'assicurazione', ass, pesoReale)

  // Contrassegno/assicurazione: se richiesti ma senza tariffa (nella banda peso) OPPURE oltre il max
  // -> corriere non disponibile. Il max è ristretto alla banda di peso applicabile.
  const scC = supplPresenteMax(suppl || [], 'contrassegno', pesoReale)
  const contrassegnoOltreMax = cod > 0 && (!scC.presente || cod > scC.max)
  const scA = supplPresenteMax(suppl || [], 'assicurazione', pesoReale)
  const assicurazioneOltreMax = ass > 0 && (!scA.presente || ass > scA.max)

  // SUPPLEMENTO ORIGINE: se il pacco PARTE da una zona mittente disagiata di questo corriere.
  // Esce dalle STESSE fasce già caricate (quelle marcate su_mittente). 0 se non configurato.
  const mittAmt = await supplementoMittente(
    supabase, fasce,
    { cap: params.mittCap, provincia: params.mittProvincia, paese: params.mittPaese },
    pesoFatturato,
    { cap: params.cap, provincia, paese: params.paese }   // no-stacking se dest è nella stessa regione
  )

  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    totale: r2(noloBase + fuelAmt + spondaAmt + feeCod + feeAss + mittAmt),
    nolo: r2(noloBase),
    fuel: r2(fuelAmt),
    sponda: r2(spondaAmt),
    contrassegno: r2(feeCod),
    assicurazione: r2(feeAss),
    mittente: r2(mittAmt),
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
  params: { listinoId: string; corriereId: string; contrassegno?: number; assicurazione?: number; valoreMerce?: number; nolo: number; pesoReale?: number }
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

  // STESSA logica a scaglioni condivisa (con banda-peso), ma qui null = contratto NON disponibile
  // (servizio richiesto ma non prezzato, o importo oltre il max della banda peso applicabile).
  const applica = (tipo: string, importo: number): number | null => {
    if (importo <= 0) return 0
    const scal = scaglioniPerPeso(parseScaglioniSupp(suppl || [], tipo), params.pesoReale)
      .filter(x => x.valore_max > 0).sort((a, b) => a.valore_max - b.valore_max)
    if (!scal.length) return null   // servizio richiesto ma non configurato (nella banda peso) -> non disponibile
    const s = scal.find(x => importo <= x.valore_max)
    if (!s) return null // oltre il massimo -> non disponibile per quell'importo
    const primaFasciaMax = Number(scal[0]?.valore_max) || 0
    const base = s.calcolo_su === 'differenza' ? Math.max(0, importo - primaFasciaMax) : importo
    return s.prezzo_fisso + (s.perc / 100) * base
  }

  const feeCod = applica('contrassegno', cod)
  const feeAss = applica('assicurazione', ass)
  if (feeCod === null || feeAss === null) return { contrassegno: 0, assicurazione: 0, disponibile: false }
  return { contrassegno: feeCod, assicurazione: feeAss, disponibile: true }
}

// Restringe una query zone_cap ai soli CAP da prezzare, PIU' le righe senza CAP (provincia e jolly),
// che matchZona usa quando il CAP esatto non c'e'. Senza elenco — o con troppi CAP, es. un report su
// tutto il mese — si legge tutto come prima: meglio una query grossa che mille piccole.
function zoneCapMirate(q: any, cap?: string[] | null) {
  const lista = Array.from(new Set((cap || [])
    .map(c => String(c || '').trim())
    .filter(c => /^[A-Za-z0-9-]{1,10}$/.test(c))))
  if (!lista.length || lista.length > 200) return q
  return q.or(`cap.is.null,cap.eq.*,cap.in.(${lista.join(',')})`)
}

// Versione BATCH: precarica UNA volta i listini/fasce/supplementi/zone_cap del master
// e ritorna una funzione che calcola il prezzo corriere per una spedizione in memoria,
// senza query per riga. Risultato identico a calcolaPrezzoCorriere (usato dai report).
async function creaCalcolatoreCorriereBase(
  supabase: any,
  masterId: string,
  capDaPrezzare?: string[] | null
): Promise<(s: any) => DettaglioPrezzo | null> {
  const { data: listini } = await supabase
    .from('listini_corrieri').select('id,corriere_id,fattore_volume')
    .eq('master_id', masterId).eq('attivo', true)
  const listinoIds: string[] = (listini || []).map((l: any) => l.id)
  // IN PARALLELO: override del fattore volume (listini_corrieri_corrieri), fasce e supplementi
  // dipendono tutti e tre SOLO dai listini, non l'uno dall'altro. Prima erano tre attese in fila —
  // dentro un blocco che in produzione costa 207-273 ms a ogni apertura dell'elenco.
  const [aggFvRes, fasce, supplRes] = await Promise.all([
    listinoIds.length
      ? supabase.from('listini_corrieri_corrieri').select('corriere_id,fattore_volume').in('listino_id', listinoIds)
      : Promise.resolve({ data: [] as any[] }),
    // fetchAll: le fasce possono superare le 1000 righe (limite PostgREST) — prima venivano TRONCATE
    // e il fallback prezzava con fasce incomplete (margine sbagliato oltre le prime 1000).
    listinoIds.length
      ? fetchAll(() => supabase.from('listini_corrieri_fasce').select('listino_id,peso_max,prezzo,tipo,zona_id,fuel,zone(id,nome)').in('listino_id', listinoIds))
      : Promise.resolve([] as any[]),
    listinoIds.length
      ? supabase.from('listini_corrieri_supplementi').select('listino_id,tipo,valore,tipo_calcolo,descrizione').in('listino_id', listinoIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const aggFv = (aggFvRes as any).data
  const suppl = (supplRes as any).data
  const overridePerCorr = new Map<string, number>()
  for (const a of aggFv || []) { const fv = parseFloat(a?.fattore_volume); if (a?.corriere_id && fv > 0) overridePerCorr.set(a.corriere_id, fv) }
  const listinoPerCorriere = new Map<string, { id: string; fattore: number }>()
  for (const l of listini || []) {
    const fattore = overridePerCorr.get(l.corriere_id) || parseFloat(l.fattore_volume) || 5000
    listinoPerCorriere.set(l.corriere_id, { id: l.id, fattore })
  }

  const fascePerListino = new Map<string, any[]>()
  for (const f of fasce || []) {
    if (!fascePerListino.has(f.listino_id)) fascePerListino.set(f.listino_id, [])
    fascePerListino.get(f.listino_id)!.push(f)
  }

  const supplPerListino = new Map<string, any[]>()
  for (const s of suppl || []) {
    if (!supplPerListino.has(s.listino_id)) supplPerListino.set(s.listino_id, [])
    supplPerListino.get(s.listino_id)!.push(s)
  }

  const zonaIds = Array.from(new Set((fasce || []).map((f: any) => f.zone?.id).filter(Boolean)))
  const zc: any[] = zonaIds.length
    ? await fetchAll(() => zoneCapMirate(
        supabase.from('zone_cap').select('zona_id,paese,provincia,cap,citta').in('zona_id', zonaIds), capDaPrezzare))
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
    // Commissione COD/assic: logica UNICA, banda-peso sul PESO REALE.
    const feeContr = commissioneSupp(supplList, 'contrassegno', cod, pesoReale)
    const feeAss = commissioneSupp(supplList, 'assicurazione', ass, pesoReale)
    const _r2 = (n: number) => Math.round(n * 100) / 100
    return { totale: _r2(noloBase + spondaAmt + feeContr + feeAss), nolo: _r2(noloBase), sponda: _r2(spondaAmt), contrassegno: _r2(feeContr), assicurazione: _r2(feeAss) }
  }
}

// Calcolatore batch sul LISTINO CLIENTE (listini_clienti). Usato per il COSTO dei
// sotto-master: il loro costo è il listino che il master padre gli ha assegnato
// (masters.parent_listino_id). Stessa logica di calcolaPrezzoListino, ma in memoria.
async function creaCalcolatoreListinoClienteBase(
  supabase: any,
  listinoId: string,
  capDaPrezzare?: string[] | null
): Promise<(s: any) => DettaglioPrezzo | null> {
  if (!listinoId) return () => null
  // IN PARALLELO: il listino, l'override per-corriere del fattore volume e le fasce dipendono solo
  // da listinoId. Prima erano tre attese in fila.
  const [listinoRes, aggCorrRes, fasce] = await Promise.all([
    supabase.from('listini_clienti').select('fattore_volume,solo_peso_reale').eq('id', listinoId).single(),
    supabase.from('listini_clienti_corrieri').select('corriere_id,fattore_volume').eq('listino_id', listinoId),
    // fetchAll: oltre 1000 fasce venivano TRONCATE (limite PostgREST) → prezzi fallback incompleti.
    fetchAll(() => supabase
      .from('listini_clienti_fasce').select('corriere_id,zona_id,peso_max,prezzo,tipo,fuel,zone(id,nome)')
      .eq('listino_id', listinoId)),
  ])
  const listino = (listinoRes as any).data
  const aggCorr = (aggCorrRes as any).data
  const fattore = parseFloat(listino?.fattore_volume) || 5000
  const soloPesoReale = !!listino?.solo_peso_reale
  const fattorePerCorr = new Map<string, number>()
  for (const a of (aggCorr || [])) { const fv = parseFloat(a?.fattore_volume); if (a?.corriere_id && fv > 0) fattorePerCorr.set(a.corriere_id, fv) }

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
    ? await fetchAll(() => zoneCapMirate(
        supabase.from('zone_cap').select('zona_id,paese,provincia,cap,citta').in('zona_id', zonaIds), capDaPrezzare))
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
    // Commissione COD/assic: logica UNICA, banda-peso sul PESO REALE.
    const feeContr = commissioneSupp(supplList, 'contrassegno', cod, pesoReale)
    const feeAss = commissioneSupp(supplList, 'assicurazione', ass, pesoReale)
    const _r2 = (n: number) => Math.round(n * 100) / 100
    return { totale: _r2(noloBase + spondaAmt + feeContr + feeAss), nolo: _r2(noloBase), sponda: _r2(spondaAmt), contrassegno: _r2(feeContr), assicurazione: _r2(feeAss) }
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// CACHE A TEMPO DEI CALCOLATORI.
//
// Costruirne uno non e' gratis: per un master reale sono 26 listini, 1.129 fasce e 19.225 righe di
// zone_cap, e zone_cap si legge a blocchi da 1.000 — una ventina di round-trip IN FILA. L'elenco
// spedizioni li costruisce come RIPIEGO per le righe senza movimento reale: sulla vista di rete
// capita su ~3 righe su 100, quindi praticamente a ogni apertura e a ogni cambio pagina.
//
// I listini cambiano raramente (li modifica un master a mano); una pagina aperta due secondi dopo
// puo' usare la stessa copia. TTL di CINQUE MINUTI: una modifica al listino si vede entro cinque
// minuti, e comunque questo e' solo il PREZZO DI RIPIEGO mostrato in elenco — gli addebiti veri
// vengono dai movimenti, che non passano di qui.
// Era un minuto: troppo corto perche' le istanze servono richieste a raffica per qualche minuto e
// poi restano ferme, quindi la copia scadeva quasi sempre prima di essere riusata.
//
// La chiave include l'id del master/listino. La cache vive nell'istanza serverless: se l'istanza e'
// nuova si ricostruisce, come prima.
const TTL_CALCOLATORE_MS = 300_000
const MAX_CALCOLATORI = 8
const cacheCalcolatori = new Map<string, { at: number; calc: (s: any) => DettaglioPrezzo | null }>()

function dallaCache(chiave: string) {
  const hit = cacheCalcolatori.get(chiave)
  if (hit && Date.now() - hit.at < TTL_CALCOLATORE_MS) return hit.calc
  if (hit) cacheCalcolatori.delete(chiave)
  return null
}

function inCache(chiave: string, calc: (s: any) => DettaglioPrezzo | null) {
  cacheCalcolatori.set(chiave, { at: Date.now(), calc })
  // Tetto: i calcolatori tengono in memoria le zone_cap, non se ne accumulano a decine.
  while (cacheCalcolatori.size > MAX_CALCOLATORI) {
    const piuVecchia = cacheCalcolatori.keys().next().value as string
    cacheCalcolatori.delete(piuVecchia)
  }
  return calc
}

export async function creaCalcolatoreCorriere(
  supabase: any,
  masterId: string,
  capDaPrezzare?: string[] | null
): Promise<(s: any) => DettaglioPrezzo | null> {
  // PRIMA LA CACHE: se c'e' gia' un calcolatore INTERO per questo master si usa quello — vale per
  // qualunque CAP e non costa nessuna query. Prima il ramo mirato stava sopra e scavalcava sempre la
  // cache: sul percorso dell'elenco si ricostruiva a ogni richiesta (207-273 ms misurati).
  const k = 'corr:' + masterId
  const pronto = dallaCache(k)
  if (pronto) return pronto
  // MIRATO = costruito sui soli CAP di una pagina: NON va in cache, altrimenti un report che chiede
  // lo stesso master si ritroverebbe le zone parziali e prezzerebbe sbagliato.
  if (capDaPrezzare && capDaPrezzare.length) return creaCalcolatoreCorriereBase(supabase, masterId, capDaPrezzare)
  return inCache(k, await creaCalcolatoreCorriereBase(supabase, masterId))
}

export async function creaCalcolatoreListinoCliente(
  supabase: any,
  listinoId: string,
  capDaPrezzare?: string[] | null
): Promise<(s: any) => DettaglioPrezzo | null> {
  if (!listinoId) return () => null
  const k = 'cli:' + listinoId
  const pronto = dallaCache(k)
  if (pronto) return pronto
  if (capDaPrezzare && capDaPrezzare.length) return creaCalcolatoreListinoClienteBase(supabase, listinoId, capDaPrezzare)
  return inCache(k, await creaCalcolatoreListinoClienteBase(supabase, listinoId))
}
