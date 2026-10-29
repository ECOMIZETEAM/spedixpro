/* CONTROLLO FATTURA CORRIERE: la fattura di BRT confrontata, spedizione per spedizione, con quello che
 * Moove ha registrato come COSTO al detentore del contratto, e il perché di ogni differenza.
 *
 * Tre cifre per ogni riga di andata:
 *   BRT     = quanto BRT ha fatturato (nolo + voci extra)
 *   Moove   = il costo registrato al detentore su quella spedizione (movimenti: addebito, rettifiche, rimborsi)
 *   Listino = il listino del detentore rifatto sul PESO TASSATO DA BRT, con la stessa funzione dell'addebito
 * e la differenza BRT − Moove si divide in parti che sommano esatte:
 *   peso        = Listino − Moove   → BRT ha pesato o misurato di più: è la parte che si ribalta sui clienti
 *   supplemento = voci extra che il listino PREVEDE (fuori misura… nei supplementi del corriere, sezione
 *                 Giacenze): in creazione non si sapevano, il prezzo è quello del listino
 *   voci        = voci extra che nel listino non esistono, o la parte che il listino non copre
 *   tariffa     = il resto: nolo, carburante, isole e contrassegno del listino non allineati a quelli di BRT
 *
 * Solo lettura: qui non si scrive niente. L'addebito ai clienti passa dalla Rettifica, che è la porta unica
 * del credito per i pesi (vedi REGOLE.md). */
import { fetchAllStretto } from '@/lib/fetch-all'
import { calcolaPrezzoCorriereDettaglio, type DettaglioCorriere } from '@/lib/pricing'
import { descriviVoce, type RigaFatturaBrt, type CategoriaVoce } from '@/lib/fattura-brt'
import { prezziSupplementoDa, TIPO_SUPPLEMENTO_CORRIERE } from '@/lib/supplementi-corriere'

export type TipoMotivo = 'peso' | 'supplemento' | 'voce' | 'tariffa' | 'annullata' | 'non_calcolabile'
export type Motivo = { tipo: TipoMotivo; importo: number; testo: string }

export type SpedizioneAbbinata = {
  id: string
  numero: string
  stato: string
  cliente_id: string | null
  master_id: string
  corriere_id: string
  created_at: string
  colli: number | null
  peso_reale: number | null
  peso_fatturato: number | null
  contrassegno: number | null
  dest_cap: string | null
  dest_provincia: string | null
  dest_citta: string | null
  dest_paese: string | null
}

export type EsitoRiga = {
  riga: RigaFatturaBrt
  spedizione: SpedizioneAbbinata | null
  abbinataPer: 'riferimento' | 'segnacollo' | null
  brt: number
  moove: number | null
  listino: DettaglioCorriere | null
  differenza: number | null              // BRT − Moove: positivo = il detentore ha speso più di quanto vede
  motivi: Motivo[]
  vociPerCategoria: Partial<Record<CategoriaVoce | 'nolo', number>>
}

const r2 = (n: number) => Math.round(n * 100) / 100
const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

// Le categorie che il listino di Moove sa esprimere: nolo per fascia/zona (con isole e carburante dentro o
// come percentuale) e contrassegno. Le altre voci BRT nel listino non hanno un posto.
const CATEGORIE_IN_LISTINO = new Set<CategoriaVoce | 'nolo'>(['nolo', 'carburante', 'isole', 'contrassegno'])

// I movimenti del detentore che fanno il COSTO dell'andata. Commissione (MoovExpress), reso e giacenza
// sono altre righe della fattura (o non ci sono proprio) e non vanno confrontati col nolo.
const TIPI_COSTO_ANDATA = new Set(['spedizione', 'rettifica', 'rimborso', 'accessorio'])

const COLONNE_SPED = 'id,numero,tracking_number,stato,cliente_id,master_id,corriere_id,created_at,colli,peso_reale,peso_fatturato,contrassegno,dest_cap,dest_provincia,dest_citta,dest_paese,rif:raw_response->>numericRef,tbp:raw_response->>trackingByParcelID'

const aGruppi = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const giorni = (iso: string, d: number) => new Date(new Date(iso + 'T00:00:00Z').getTime() + d * 86400000).toISOString()

// In parallelo ma a gruppi: il listino si calcola con la stessa funzione dell'addebito, che fa le sue
// letture; mille righe tutte insieme sarebbero mille raffiche sul database di produzione.
async function aOndate<T, R>(items: T[], quanti: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(quanti, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

export async function analizzaFatturaBrt(
  admin: any,
  params: { contrattoId: string; masterId: string; righe: RigaFatturaBrt[] },
): Promise<EsitoRiga[]> {
  const { contrattoId, masterId, righe } = params

  // Il contratto e TUTTE le sue copie (sotto-master, collegati): sullo stesso conto BRT passano anche le
  // spedizioni di chi lo compra dal detentore, e la fattura le porta tutte.
  const { data: famiglia } = await admin.from('corrieri').select('id').eq('contratto_id', contrattoId)
  const corrieriIds: string[] = Array.from(new Set([contrattoId, ...((famiglia || []).map((c: any) => c.id))]))

  // Finestra di date: dal ritiro più vecchio (meno 15 giorni: si crea prima di consegnare al corriere)
  // al più recente. Una spedizione fuori finestra non si perde: la cerca il segnacollo, sotto.
  const date = righe.map(r => r.dataRitiro || r.dataFattura).filter(Boolean).sort() as string[]
  const spedizioni: any[] = date.length
    ? await fetchAllStretto(() => admin.from('spedizioni').select(COLONNE_SPED)
        .in('corriere_id', corrieriIds)
        .gte('created_at', giorni(date[0], -15)).lt('created_at', giorni(date[date.length - 1], 2))
        .order('created_at').order('id'))
    : []
  const perRif = new Map<string, any>(), perSegnacollo = new Map<string, any>()
  const indicizza = (s: any) => {
    if (s.rif) perRif.set(String(s.rif).replace(/^0+(?=\d)/, ''), s)
    for (const t of [s.tracking_number, s.tbp]) if (t) perSegnacollo.set(String(t).trim(), s)
  }
  spedizioni.forEach(indicizza)

  const mancanti = righe.filter(r => !perRif.has(r.rifNumerico) && r.segnacollo && !perSegnacollo.has(r.segnacollo)).map(r => r.segnacollo)
  for (const g of aGruppi(Array.from(new Set(mancanti)), 200)) {
    const { data, error } = await admin.from('spedizioni').select(COLONNE_SPED).in('corriere_id', corrieriIds).in('tracking_number', g)
    if (error) throw new Error('lettura spedizioni per segnacollo non riuscita: ' + error.message)
    ;(data || []).forEach(indicizza)
  }

  const abbinate = righe.map(r => {
    const perR = r.rifNumerico ? perRif.get(r.rifNumerico) : undefined
    if (perR) return { s: perR, per: 'riferimento' as const }
    const perS = r.segnacollo ? perSegnacollo.get(r.segnacollo) : undefined
    return perS ? { s: perS, per: 'segnacollo' as const } : { s: null, per: null }
  })

  // Il costo registrato al detentore, spedizione per spedizione.
  const ids = Array.from(new Set(abbinate.map(a => a.s?.id).filter(Boolean))) as string[]
  const costo = new Map<string, number>()
  for (const g of aGruppi(ids, 200)) {
    const { data, error } = await admin.from('movimenti').select('spedizione_id,tipo,importo')
      .eq('master_target_id', masterId).in('spedizione_id', g)
    if (error) throw new Error('lettura movimenti non riuscita: ' + error.message)
    for (const m of data || []) {
      if (!TIPI_COSTO_ANDATA.has(m.tipo)) continue
      costo.set(m.spedizione_id, (costo.get(m.spedizione_id) || 0) - Number(m.importo || 0))
    }
  }

  // I supplementi del corriere nel listino del detentore (fuori misura…): il prezzo con cui una voce BRT
  // risulta prevista. Prima riga per id, come legge le giacenze l'addebito.
  const { data: listiniDet } = await admin.from('listini_corrieri').select('id').eq('master_id', masterId)
  const idsDet = (listiniDet || []).map((l: any) => l.id)
  const { data: supplDet, error: errSuppl } = idsDet.length
    ? await admin.from('listini_corrieri_supplementi').select('tipo,nome,valore').in('listino_id', idsDet)
        .eq('corriere_id', contrattoId).eq('tipo', TIPO_SUPPLEMENTO_CORRIERE).order('id', { ascending: true })
    : { data: [], error: null }
  if (errSuppl) throw new Error('lettura supplementi del listino non riuscita: ' + errSuppl.message)
  const prezziSupplemento = prezziSupplementoDa(supplDet || [])

  // Il listino del detentore sul peso tassato da BRT. Stesse righe = stesso calcolo: si fa una volta.
  const memo = new Map<string, Promise<DettaglioCorriere | null>>()
  const listinoDi = (r: RigaFatturaBrt, s: any) => {
    const cod = Number(s.contrassegno || 0)
    const k = [s.dest_cap || r.cap, s.dest_provincia || r.provincia, s.dest_citta || r.localita, r.pesoTassato, cod].join('|')
    if (!memo.has(k)) memo.set(k, calcolaPrezzoCorriereDettaglio(admin, {
      corriereId: contrattoId, masterId,
      provincia: String(s.dest_provincia || r.provincia || '').toUpperCase(),
      cap: s.dest_cap || r.cap, citta: s.dest_citta || r.localita, paese: s.dest_paese || r.nazione || 'IT',
      pesoReale: r.pesoTassato, contrassegno: cod,
    }).catch(() => null))
    return memo.get(k)!
  }

  return aOndate(righe.map((r, i) => ({ r, a: abbinate[i] })), 8, async ({ r, a }): Promise<EsitoRiga> => {
    const vociPerCategoria: EsitoRiga['vociPerCategoria'] = { nolo: r.nolo }
    for (const v of r.voci) { const c = descriviVoce(v.sigla).categoria; vociPerCategoria[c] = r2((vociPerCategoria[c] || 0) + v.importo) }
    const base = { riga: r, spedizione: a.s as SpedizioneAbbinata | null, abbinataPer: a.per, brt: r2(r.totale), vociPerCategoria }
    if (!a.s) return { ...base, moove: null, listino: null, differenza: null, motivi: [] }

    const s = a.s
    const moove = r2(costo.get(s.id) || 0)
    const differenza = r2(r.totale - moove)
    const motivi: Motivo[] = []

    // Annullata in Moove (costo rimborsato) ma BRT l'ha fatturata: il pacco è partito lo stesso, oppure
    // l'annullo non è arrivato a BRT. In entrambi i casi è tutta perdita finché non si chiarisce.
    if (s.stato === 'annullata' && r.totale > 0) {
      motivi.push({ tipo: 'annullata', importo: differenza, testo: `Annullata in Moove (costo rimborsato), ma BRT l'ha fatturata ${euro(r.totale)}.` })
      return { ...base, moove, listino: null, differenza, motivi }
    }
    if (!r.andata) return { ...base, moove, listino: null, differenza, motivi }

    const listino = await listinoDi(r, s)
    if (!listino) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, testo: `Il listino non dà un prezzo per ${r.cap} ${r.provincia} a ${kg(r.pesoTassato)} kg: zona o fascia mancante.` })
      return { ...base, moove, listino, differenza, motivi }
    }

    const peso = r2(listino.totale - moove)
    if (Math.abs(peso) >= 0.01) {
      const dich = Number(s.peso_fatturato || s.peso_reale || 0)
      const come = r.pesoRilevato > dich + 0.001 ? `pesato ${kg(r.pesoRilevato)} kg`
        : Math.max(r.volumeFatturare, r.volumeRilevato) * 200 > dich + 0.001 ? `misurato ${Math.max(r.volumeFatturare, r.volumeRilevato).toLocaleString('it-IT')} m³ (${kg(Math.max(r.volumeFatturare, r.volumeRilevato) * 200)} kg di volume)`
        : `tassato ${kg(r.pesoTassato)} kg`
      motivi.push({ tipo: 'peso', importo: peso, testo: peso > 0
        ? `Moove ${kg(dich)} kg, BRT ha ${come}: col tuo listino il costo sale da ${euro(moove)} a ${euro(listino.totale)}.`
        : `Moove ha addebitato ${euro(moove)}, ma al peso di BRT (${kg(r.pesoTassato)} kg) il tuo listino dice ${euro(listino.totale)}.` })
    }

    // BRT calcola il carburante anche sopra le voci extra (sulla "i" da 6,90 € sono 0,55 € in più): quel
    // carburante appartiene alla voce, non al nolo, altrimenti un listino giusto sembrerebbe sotto costo.
    // La percentuale si ricava dalla riga stessa: carburante / (tutto ciò che non è carburante né contrassegno).
    const baseCarburante = r.nolo + r.voci.reduce((s, v) => { const c = descriviVoce(v.sigla).categoria; return c === 'carburante' || c === 'contrassegno' ? s : s + v.importo }, 0)
    const quotaCarburante = baseCarburante > 0 ? (vociPerCategoria.carburante || 0) / baseCarburante : 0
    let fuori = 0
    for (const v of r.voci) {
      const d = descriviVoce(v.sigla)
      if (CATEGORIE_IN_LISTINO.has(d.categoria) || Math.abs(v.importo) < 0.005) continue
      const conCarburante = r2(v.importo * (1 + quotaCarburante))
      fuori += conCarburante
      const sopra = r2(conCarburante - v.importo)
      const brtVoce = `${euro(v.importo)}${sopra >= 0.01 ? ` + ${euro(sopra)} di carburante` : ''}`
      const prevista = d.voceListino ? prezziSupplemento.get(d.voceListino.toLowerCase()) : undefined
      if (!prevista) {
        motivi.push({ tipo: 'voce', importo: conCarburante, testo: `${d.nome} (sigla BRT "${v.sigla}"): ${brtVoce}, nel tuo listino non c'è${d.voceListino ? ` ("${d.voceListino}" vuoto nei supplementi del corriere, sezione Giacenze)` : ''}.` })
        continue
      }
      // Prevista dal listino: in creazione non si sapeva, quindi Moove non l'ha addebitata. Quel che il
      // listino non copre (di solito il carburante che BRT ci calcola sopra) resta una voce a parte.
      motivi.push({ tipo: 'supplemento', importo: prevista, testo: `${d.voceListino} (sigla BRT "${v.sigla}"): ${euro(prevista)} dal tuo listino. In creazione non si sapeva: BRT lo mette dopo, va girato a chi ha spedito.` })
      const resto = r2(conCarburante - prevista)
      if (Math.abs(resto) >= 0.01) motivi.push({ tipo: 'voce', importo: resto, testo: `${d.voceListino} (sigla BRT "${v.sigla}"): BRT chiede ${brtVoce}, il tuo listino ${euro(prevista)}: listino ${resto > 0 ? 'più basso' : 'più alto'} di ${euro(Math.abs(resto))}.` })
    }

    const tariffa = r2(differenza - peso - fuori)
    if (Math.abs(tariffa) >= 0.01) {
      const brtTariffa = r2(r.totale - fuori)
      motivi.push({ tipo: 'tariffa', importo: tariffa, testo: tariffa > 0
        ? `A parità di peso BRT chiede ${euro(brtTariffa)} (nolo ${euro(r.nolo)} + carburante, isole, contrassegno), il tuo listino ${euro(listino.totale)}: listino più basso del vero.`
        : `A parità di peso BRT chiede ${euro(brtTariffa)}, il tuo listino ${euro(listino.totale)}: listino più alto del vero.` })
    }
    return { ...base, moove, listino, differenza, motivi }
  })
}
