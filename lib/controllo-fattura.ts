/* CONTROLLO FATTURA CORRIERE: la fattura di BRT confrontata, spedizione per spedizione, con quello che
 * Moove ha registrato come COSTO al detentore del contratto, e il perché di ogni differenza.
 *
 * Tre cifre per ogni riga di andata:
 *   BRT     = quanto BRT ha fatturato (nolo + voci extra)
 *   Moove   = il costo registrato al detentore su quella spedizione (movimenti: addebito, rettifiche, rimborsi)
 *   Listino = il listino del detentore rifatto sul PESO TASSATO DA BRT, con la stessa funzione dell'addebito
 * e la differenza BRT − Moove si divide in parti che sommano esatte, come per GLS (lib/controllo-fattura-gls):
 *   peso        = listino al peso di BRT − listino al peso di Moove, tutti e due di OGGI → BRT ha pesato o misurato
 *                 di più: si gira ai clienti. Prima era listino di oggi − costo registrato, e un listino cambiato
 *                 dopo la spedizione sembrava un pacco pesato di più (e andava alla Rettifica).
 *   carburante  = la parte di carburante oltre la percentuale del listino, quando il listino ne dichiara una
 *   supplemento = voci extra che il listino PREVEDE (fuori misura… nei supplementi del corriere, sezione
 *                 Giacenze): in creazione non si sapevano, il prezzo è quello del listino
 *   voce        = voci extra che nel listino non esistono, o la parte che il listino non copre
 *   tariffa     = il resto: nolo, carburante, isole e contrassegno del listino non allineati a quelli di BRT
 * A parte, fuori dalla somma, `scartoListino` e `allinea`: BRT contro il listino di OGGI allo stesso peso, voce per
 * voce, per «Cosa allineare nel listino» (quale listino, quale zona, cosa c'è scritto e cosa chiede BRT).
 *
 * Ogni motivo ha il suo `gruppo` (contestare, girare ai clienti, chiarire, sistemare in Moove): Lorenzo, 27/11,
 * «idem deve essere per BRT» — ogni voce porta a un gesto, e il gesto lo decide chi paga.
 *
 * I RIENTRI (bolle A2 e A3, e le F3 delle spese di giacenza) delle spedizioni Moove si confrontano col costo del reso e
 * della giacenza registrato in Moove, non col costo dell'andata: prima la riga del reso portava il costo dell'andata,
 * e se andata e reso stavano nella stessa fattura quel costo si contava due volte.
 *
 * Solo lettura: qui non si scrive niente. L'addebito ai clienti passa dalla Rettifica, che è la porta unica
 * del credito per i pesi (vedi REGOLE.md). */
import { fetchAllStretto } from '@/lib/fetch-all'
import { calcolaPrezzoCorriereDettaglio, type DettaglioCorriere } from '@/lib/pricing'
import { accessoriDelLivello } from '@/lib/cascata'
import { movimentiDelNolo } from '@/lib/ripesature-calcolo'
import { descriviVoce, carburanteRigaBrt, type RigaFatturaBrt, type CategoriaVoce } from '@/lib/fattura-brt'
import type { AllineaGls, ParteAllinea } from '@/lib/fattura-gls'
import { prezziSupplementoDa, TIPO_SUPPLEMENTO_CORRIERE } from '@/lib/supplementi-corriere'

export type TipoMotivo = 'peso' | 'supplemento' | 'voce' | 'tariffa' | 'annullata' | 'non_calcolabile' | 'carburante' | 'storico'
// `voce` e `gruppo`: il nome della voce per raggrupparla e cosa farne (contestare al corriere, girare ai clienti,
// chiarire col corriere, allineare il listino). `nota`: cosa vuol dire la voce, uguale per tutte le sue spedizioni
// (il `testo` è quello della singola spedizione, con i suoi importi).
export type GruppoMotivo = 'contestare' | 'clienti' | 'chiarire' | 'listino'
export type Motivo = { tipo: TipoMotivo; importo: number; testo: string; voce?: string; gruppo?: GruppoMotivo; nota?: string }

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
  differenza: number | null              // corriere − Moove: positivo = il detentore ha speso più di quanto vede
  scartoListino?: number | null          // corriere − listino di OGGI allo stesso peso
  allinea?: AllineaGls                   // quello scarto diviso per listino, zona e voce (lib/fattura-gls)
  contratto?: string                     // il contratto del detentore (= il suo listino di costo)
  incasso?: { importo: number; chi: 'cliente' | 'master'; id: string } | null   // quanto ha pagato chi sta sotto
  motivi: Motivo[]
  vociPerCategoria: Partial<Record<CategoriaVoce | 'nolo', number>>
}

const r2 = (n: number) => Math.round(n * 100) / 100
const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const pct = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%'

// Le categorie che il listino di Moove sa esprimere: nolo per fascia/zona (con isole e carburante dentro o
// come percentuale) e contrassegno. Le altre voci BRT nel listino non hanno un posto.
const CATEGORIE_IN_LISTINO = new Set<CategoriaVoce | 'nolo'>(['nolo', 'carburante', 'isole', 'contrassegno'])

// I movimenti del detentore che si leggono: quelli dell'andata (addebito, rettifiche, rimborsi, servizi) e quelli
// dei rientri (reso, giacenza). Le rettifiche passano da movimentiDelNolo (la regola delle ripesature): fuori i costi
// di resi e giacenze del fornitore e gli storni dei resi, che col tipo 'rettifica' sembrerebbero nolo.
const TIPI_LETTI = ['spedizione', 'rettifica', 'reso', 'giacenza', 'rimborso', 'accessorio']
// Le rettifiche che appartengono al rientro e non all'andata (vedi movimentiDelNolo).
const RIF_RIENTRO = /^(RESOFORN|GIACFORN|STORNOFORN)-/
// Supabase taglia una risposta a 1.000 righe senza errore: arrivarci vuol dire che ne mancano.
const TETTO = 1000
// Sotto questo scarto la percentuale del carburante è la stessa (BRT la calcola al millesimo su ogni riga).
const TOLLERANZA_CARBURANTE = 0.25

const COLONNE_SPED = 'id,numero,tracking_number,stato,cliente_id,master_id,corriere_id,created_at,colli,peso_reale,peso_fatturato,contrassegno,dest_cap,dest_provincia,dest_citta,dest_paese,servizi_accessori,assicurazione,rif:raw_response->>numericRef,tbp:raw_response->>trackingByParcelID'

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

// IL CARBURANTE CHE IL LISTINO DEL DETENTORE DICHIARA su quei contratti: quello delle fasce della zona Italia (o, senza,
// delle altre zone italiane). 0 o vuoto vuol dire "non dichiarato", non "0% da contratto": c'è chi lo tiene dentro il
// prezzo (il listino BRT EXPRESS W di Wave: 4,60 € a 3 kg, che sono i 4,10 € di BRT più il 12,5%). In quel caso il
// carburante di BRT non si confronta da solo: sta nel totale, che si confronta col prezzo. Una lettura non riuscita
// ferma il controllo: meglio dirlo che confrontare con un carburante che non c'è.
export async function carburanteDelListino(admin: any, masterId: string, corrieriIds: string[]): Promise<number | null> {
  const { data: listini, error: errL } = await admin.from('listini_corrieri').select('id').eq('master_id', masterId)
  if (errL) throw new Error('lettura dei listini non riuscita: ' + errL.message)
  const idsListini = (listini || []).map((l: any) => l.id)
  if (!idsListini.length || !corrieriIds.length) return null
  // Tutte le fasce, a pagine: un .limit() non supera il taglio a 1.000 righe, e la percentuale "più frequente" si
  // calcolerebbe su una parte presa a caso (revisione del 27/11).
  const fasce: any[] = await fetchAllStretto(() => admin.from('listini_corrieri_fasce').select('id,fuel,zone(nome)')
    .in('listino_id', idsListini).in('corriere_id', corrieriIds).order('id'))
  const conta = (filtro: (z: string) => boolean) => {
    const m = new Map<number, number>()
    for (const f of fasce || []) { const v = Number((f as any).fuel) || 0; if (v > 0 && filtro(String((f as any).zone?.nome || ''))) m.set(v, (m.get(v) || 0) + 1) }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  return conta(z => /^italia$/i.test(z.trim())) ?? conta(z => !/europa|estero|internaz/i.test(z))
}

// Cosa fare di una voce BRT che il listino non ha. Una sigla che non si sa leggere si chiede a BRT. La "b" (l'1,5%
// sul totale, nuova da novembre) è un ritocco della tariffa, non una cosa che il pacco ha fatto: o è nel contratto o
// si contesta. Le altre (colli incompatibili, fuori misura, ZTL) sono vere e in creazione non si sapevano: si girano a
// chi ha spedito. I servizi (assicurazione, appuntamento…) no: si chiedono e si pagano in creazione (vedi più sotto).
const gruppoVoceBrt = (d: { certa: boolean; sopraIlCarburante?: boolean }): GruppoMotivo => !d.certa ? 'chiarire' : d.sopraIlCarburante ? 'contestare' : 'clienti'
const notaVoceBrt = (d: { nome: string; certa: boolean; sopraIlCarburante?: boolean; voceListino?: string }, sigla: string) =>
  !d.certa ? `BRT la scrive con la sigla "${sigla}" e non dice cos'è: chiedilo a BRT (o aggiungi il PDF della fattura, che ha la legenda) prima di pagarla o girarla.`
    : d.sopraIlCarburante ? `BRT la calcola su tutta la riga, carburante compreso. Nel tuo listino non c'è: se non è nel tuo contratto con BRT contestala, se c'è assorbila o girala ai clienti.`
    : `BRT la mette dopo la creazione e nel tuo listino non ha un prezzo: si gira a chi ha spedito.${d.voceListino ? ` Mettila nei supplementi del corriere («${d.voceListino}», sezione Giacenze), così le prossime le vedi già previste.` : ''}`

export async function analizzaFatturaBrt(
  admin: any,
  params: { contrattoId: string; masterId: string; righe: RigaFatturaBrt[]; legenda?: Record<string, string> | null },
): Promise<EsitoRiga[]> {
  const { contrattoId, masterId, righe, legenda } = params

  // Il contratto e TUTTE le sue copie (sotto-master, collegati): sullo stesso conto BRT passano anche le
  // spedizioni di chi lo compra dal detentore, e la fattura le porta tutte.
  const { data: famiglia, error: errF } = await admin.from('corrieri').select('id').eq('contratto_id', contrattoId)
  if (errF) throw new Error('lettura contratti non riuscita: ' + errF.message)
  const corrieriIds: string[] = Array.from(new Set([contrattoId, ...((famiglia || []).map((c: any) => c.id))]))
  // Il nome del contratto è anche il nome del suo listino: in «Cosa allineare nel listino» dice QUALE listino toccare.
  const { data: proprio, error: errP } = await admin.from('corrieri').select('nome_contratto').eq('id', contrattoId).maybeSingle()
  if (errP) throw new Error('lettura contratto non riuscita: ' + errP.message)
  const nomeContratto = String(proprio?.nome_contratto || '')
  const carbDichiarato = await carburanteDelListino(admin, masterId, [contrattoId])

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

  // Il costo registrato al detentore, spedizione per spedizione: andata e rientri separati.
  const ids = Array.from(new Set(abbinate.map(a => a.s?.id).filter(Boolean))) as string[]
  const movPerSped = new Map<string, any[]>()
  for (const g of aGruppi(ids, 100)) {
    const { data, error } = await admin.from('movimenti').select('spedizione_id,importo,cliente_id,master_id,master_target_id,tipo,riferimento')
      .eq('master_target_id', masterId).in('spedizione_id', g).in('tipo', TIPI_LETTI)
    if (error) throw new Error('lettura movimenti non riuscita: ' + error.message)
    if ((data || []).length >= TETTO) throw new Error('troppi movimenti in una lettura: rischio di perderne')
    for (const m of data || []) { const v = movPerSped.get(m.spedizione_id) || []; v.push(m); movPerSped.set(m.spedizione_id, v) }
  }
  const somma = (l: any[]) => r2(l.reduce((t, m) => t - Number(m.importo || 0), 0))
  const dellAndata = (mov: any[]) => [...movimentiDelNolo(mov.filter(m => m.tipo !== 'rimborso' && m.tipo !== 'accessorio')), ...mov.filter(m => m.tipo === 'rimborso' || m.tipo === 'accessorio')]
  const delRientro = (mov: any[]) => mov.filter(m => m.tipo === 'reso' || m.tipo === 'giacenza' || (m.tipo === 'rettifica' && RIF_RIENTRO.test(String(m.riferimento || ''))))
  const costoDi = (id: string) => {
    const mov = movPerSped.get(id) || []
    const conta = dellAndata(mov)
    // La parte del costo che viene da una rettifica confermata (peso o supplemento del corriere, RIPFORN-…): è già
    // stata girata a chi sta sotto (vedi «già girato» qui sotto).
    const rettificato = somma(conta.filter(m => String(m.riferimento || '').startsWith('RIPFORN-')))
    return { costo: somma(conta), movimenti: conta.length, rettificato, rientro: somma(delRientro(mov)) }
  }

  // QUANTO HA INCASSATO IL DETENTORE da chi sta sotto, come per GLS (Lorenzo, 25/11: per ogni spedizione "quanto ha
  // pagato lui, il cliente e quanto gli ha fatto pagare il corriere"): il cliente diretto coi movimenti scritti dal
  // detentore, il sotto-master figlio coi suoi movimenti d'albero. Andata e rientri separati, come il costo.
  const { data: figli, error: errFi } = await admin.from('masters').select('id').eq('parent_master_id', masterId)
  if (errFi) throw new Error('lettura sotto-master non riuscita: ' + errFi.message)
  const idsFigli = (figli || []).map((m: any) => m.id as string)
  const incassiPerSped = new Map<string, any[]>()
  for (const g of aGruppi(ids, 100)) {
    const { data, error } = await admin.from('movimenti').select('spedizione_id,importo,cliente_id,master_id,master_target_id,tipo,riferimento')
      .in('spedizione_id', g).in('tipo', TIPI_LETTI)
      .or(`and(master_id.eq.${masterId},cliente_id.not.is.null)${idsFigli.length ? `,master_target_id.in.(${idsFigli.join(',')})` : ''}`)
    if (error) throw new Error('lettura incassi non riuscita: ' + error.message)
    if ((data || []).length >= TETTO) throw new Error('troppi movimenti in una lettura: rischio di perderne')
    for (const m of data || []) {
      if (!m.cliente_id && !(m.master_id === m.master_target_id || m.master_id === masterId)) continue
      const v = incassiPerSped.get(m.spedizione_id) || []; v.push(m); incassiPerSped.set(m.spedizione_id, v)
    }
  }
  const incassoDi = (id: string, rientro: boolean): { importo: number; chi: 'cliente' | 'master'; id: string } | null => {
    const mov = incassiPerSped.get(id) || []
    const conta = rientro ? delRientro(mov) : dellAndata(mov)
    if (!conta.length) return null
    const primo = mov.find(m => m.tipo === 'spedizione') || conta[0]
    return { importo: somma(conta), chi: primo.cliente_id ? 'cliente' : 'master', id: primo.cliente_id || primo.master_target_id }
  }

  // I supplementi del corriere nel listino del detentore (fuori misura…): il prezzo con cui una voce BRT
  // risulta prevista. Prima riga per id, come legge le giacenze l'addebito.
  const { data: listiniDet, error: errLd } = await admin.from('listini_corrieri').select('id').eq('master_id', masterId)
  if (errLd) throw new Error('lettura listini non riuscita: ' + errLd.message)
  const idsDet = (listiniDet || []).map((l: any) => l.id)
  const { data: supplDet, error: errSuppl } = idsDet.length
    ? await admin.from('listini_corrieri_supplementi').select('tipo,nome,valore').in('listino_id', idsDet)
        .eq('corriere_id', contrattoId).eq('tipo', TIPO_SUPPLEMENTO_CORRIERE).order('id', { ascending: true })
    : { data: [], error: null }
  if (errSuppl) throw new Error('lettura supplementi del listino non riuscita: ' + errSuppl.message)
  const prezziSupplemento = prezziSupplementoDa(supplDet || [])

  // Il listino del detentore a un peso, con contrassegno e assicurazione della spedizione (il costo registrato li
  // contiene). Stesse righe = stesso calcolo: si fa una volta. Un null si riprova una volta (GLS, 24/11: 16 righe "senza
  // prezzo" che rifatte subito dopo davano il prezzo); un errore vero ferma il pacchetto, come per GLS: la pagina dice
  // "controllo interrotto" invece di salvare un "zona mancante" che non c'è.
  const memo = new Map<string, Promise<DettaglioCorriere | null>>()
  const listinoDi = (r: RigaFatturaBrt, s: any, peso: number) => {
    const cod = Number(s.contrassegno || 0), assic = Number(s.assicurazione || 0)
    const k = [s.dest_cap || r.cap, s.dest_provincia || r.provincia, s.dest_citta || r.localita, s.dest_paese || r.nazione, peso, cod, assic].join('|')
    const calcola = () => calcolaPrezzoCorriereDettaglio(admin, {
      corriereId: contrattoId, masterId,
      provincia: String(s.dest_provincia || r.provincia || '').toUpperCase(),
      cap: s.dest_cap || r.cap, citta: s.dest_citta || r.localita, paese: s.dest_paese || r.nazione || 'IT',
      pesoReale: peso, contrassegno: cod, ...(assic > 0 ? { assicurazione: assic } : {}),
    })
    if (!memo.has(k)) memo.set(k, calcola().then(async d => d ?? (await new Promise(ok => setTimeout(ok, 400)), calcola())))
    return memo.get(k)!
  }

  // IL COSTO DEL RIENTRO SI CONTA UNA VOLTA. Lo stesso pacco può avere più righe di rientro nella stessa fattura (il reso
  // A2 e le spese di giacenza F3): il costo del reso e della giacenza registrato in Moove va sulla prima (A2, poi A3,
  // poi F3), le altre partono da zero. Se no lo stesso costo si toglieva due volte e il «non recuperato» usciva più basso
  // (prova del 27/11 sulla 067034439121082: 20,50 € invece di 27,00 €). La pagina manda le righe dello stesso pacco nello
  // stesso pacchetto.
  const ordineRientro = (t: string) => ({ A2: 0, A3: 1, F3: 2 } as Record<string, number>)[t] ?? 3
  const rientroPrimo = new Map<string, number>()
  righe.forEach((r, i) => {
    const id = abbinate[i].s?.id; if (!id || r.andata) return
    const j = rientroPrimo.get(id)
    if (j == null || ordineRientro(r.tipoBolla) < ordineRientro(righe[j].tipoBolla)) rientroPrimo.set(id, i)
  })

  return aOndate(righe.map((r, i) => ({ r, a: abbinate[i], i })), 8, async ({ r, a, i }): Promise<EsitoRiga> => {
    const vociPerCategoria: EsitoRiga['vociPerCategoria'] = { nolo: r.nolo }
    for (const v of r.voci) { const c = descriviVoce(v.sigla, legenda).categoria; vociPerCategoria[c] = r2((vociPerCategoria[c] || 0) + v.importo) }
    const base = { riga: r, spedizione: a.s as SpedizioneAbbinata | null, abbinataPer: a.per, brt: r2(r.totale), vociPerCategoria }
    if (!a.s) return { ...base, moove: null, listino: null, differenza: null, motivi: [] }

    const s = a.s
    const c = costoDi(s.id)
    // L'incasso del rientro, come il suo costo, sulla prima riga di rientro del pacco: su due righe (A2 e F3) il conto del
    // documento lo contava due volte (revisione del 27/11).
    const conSped = { ...base, contratto: nomeContratto, incasso: r.andata || rientroPrimo.get(s.id) === i ? incassoDi(s.id, !r.andata) : null }
    const motivi: Motivo[] = []

    // Annullata in Moove (costo rimborsato) ma BRT l'ha fatturata: il pacco è partito lo stesso, oppure
    // l'annullo non è arrivato a BRT. In entrambi i casi è tutta perdita finché non si chiarisce.
    if (s.stato === 'annullata' && r.totale > 0) {
      const moove = r.andata ? c.costo : rientroPrimo.get(s.id) === i ? c.rientro : 0, differenza = r2(r.totale - moove)
      motivi.push({ tipo: 'annullata', importo: differenza, gruppo: 'contestare', testo: `Annullata in Moove (costo rimborsato), ma BRT l'ha fatturata ${euro(r.totale)}: il pacco è partito lo stesso o l'annullo non è arrivato a BRT.` })
      return { ...conSped, moove, listino: null, differenza, motivi }
    }

    // IL RIENTRO (A2 reso al mittente, A3 dirottamento, F3 spese di giacenza della filiale): BRT contro quello che Moove
    // ha registrato per il reso e la giacenza di quella spedizione. Wave, TIVAF di ottobre: un reso da 2 kg costa
    // 22,61 € (nolo 4,10 + giacenza 16 + carburante), e nel listino BRT EXPRESS W le giacenze sono a 0 €. Si decide col
    // listino (contesto, correggo il listino, assorbo), NON con la Rettifica: la Rettifica tiene un supplemento per
    // spedizione e il reso ha già la sua coda di addebito (fn_addebita_resi): un reso girato da qui poteva sparire
    // dietro un supplemento dell'andata, o essere addebitato due volte (revisione del 27/11). Il costo del rientro è
    // quello di tutta la vita del pacco: con l'A2 in una fattura e l'F3 in un'altra si toglie in tutte e due (limite noto).
    if (!r.andata) {
      const primo = rientroPrimo.get(s.id) === i
      const moove = primo ? c.rientro : 0, differenza = r2(r.totale - moove)
      if (Math.abs(differenza) >= 0.01) {
        const tipo = r.tipoBolla === 'A2' ? 'Reso al mittente' : r.tipoBolla === 'F3' ? 'Spese di giacenza' : r.tipoBolla === 'A3' ? 'Riconsegna o dirottamento' : `Rientro ${r.tipoBolla}`
        const cosa = [r.nolo > 0.005 ? `nolo ${euro(r.nolo)}` : '', ...r.voci.filter(v => Math.abs(v.importo) >= 0.005).map(v => `${descriviVoce(v.sigla, legenda).nome.toLowerCase()} ${euro(v.importo)}`)].filter(Boolean).join(' + ')
        motivi.push(differenza > 0
          ? { tipo: 'voce', importo: differenza, gruppo: 'listino', voce: 'Resi e giacenze di BRT',
              nota: 'Resi al mittente, giacenze e riconsegne che BRT fa pagare: in Moove non sono registrati (o lo sono per meno), perché nel tuo listino resi e giacenze costano meno. Se BRT ha ragione correggi il listino (supplementi del corriere, sezione Giacenze): le prossime le paga chi spedisce. Se no contestale.',
              testo: `${tipo}: BRT ${euro(r.totale)} (${cosa}), in Moove ${moove > 0.005 ? `registrati ${euro(moove)}` : !primo && c.rientro > 0.005 ? `niente su questa riga (il reso registrato, ${euro(c.rientro)}, è sull'altra riga di rientro)` : 'niente'}: ${euro(differenza)} non recuperati.` }
          : { tipo: 'voce', importo: differenza, gruppo: 'listino', voce: 'Resi e giacenze: Moove più di BRT',
              nota: 'Per questi rientri Moove registra più di quanto chiede BRT: la percentuale del reso nel listino è più alta del vero.',
              testo: `${tipo}: BRT ${euro(r.totale)}, in Moove registrati ${euro(moove)}.` })
      }
      return { ...conSped, moove, listino: null, differenza, motivi }
    }

    const moove = c.costo
    const differenza = r2(r.totale - moove)
    // Trovata, ma senza un movimento del detentore: il costo 0 non è un prezzo, è un costo che manca.
    if (!c.movimenti) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, gruppo: 'listino', testo: `In Moove non c'è il costo del detentore su questa spedizione: BRT ${euro(r.totale)}, costo registrato nessuno.` })
      return { ...conSped, moove, listino: null, differenza, motivi }
    }
    // BRT chiede quanto Moove ha registrato (BRT scrive tre decimali: 4,6125 contro 4,60 è lo stesso prezzo): niente
    // da spiegare né da girare, e il listino non si rifà (ogni listino rifatto sono letture sul database di produzione).
    if (Math.abs(differenza) < 0.015) return { ...conSped, moove, listino: null, differenza, motivi }

    const listino = await listinoDi(r, s, r.pesoTassato)
    if (!listino) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, gruppo: 'listino', testo: `Il listino non dà un prezzo per ${r.cap} ${r.provincia} a ${kg(r.pesoTassato)} kg: zona o fascia mancante (o una lettura non riuscita: «Rifai con le regole di oggi» la rifà).` })
      return { ...conSped, moove, listino, differenza, motivi }
    }
    const pesoMoove = Number(s.peso_fatturato || s.peso_reale || 0)
    const listinoMoove = Math.abs(pesoMoove - r.pesoTassato) < 0.001 ? listino : await listinoDi(r, s, pesoMoove)
    // Senza il listino al peso di Moove l'effetto del peso non si separa: finirebbe tutto nella tariffa come
    // "listino più basso", e la spedizione non andrebbe alla Rettifica. Meglio dire che non si calcola.
    if (!listinoMoove) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, gruppo: 'listino', testo: `Il listino non dà un prezzo per ${r.cap} ${r.provincia} al peso di Moove (${kg(pesoMoove)} kg): l'effetto del peso di BRT non si può separare (o una lettura non riuscita: «Rifai con le regole di oggi» la rifà).` })
      return { ...conSped, moove, listino, differenza, motivi }
    }
    // I servizi chiesti col prezzo del listino del detentore, come li somma la creazione.
    const conServizi = Array.isArray(s.servizi_accessori) && s.servizi_accessori.length > 0
    const accessori = async (l: DettaglioCorriere) => conServizi ? (await accessoriDelLivello(admin, masterId, contrattoId, s.servizi_accessori, l.nolo)).totale : 0
    const accG = await accessori(listino)
    const accM = listinoMoove === listino ? accG : await accessori(listinoMoove)
    const totG = r2(listino.totale + accG)                                   // listino di oggi al peso di BRT
    const totM = r2(listinoMoove.totale + accM)                              // e al peso di Moove

    // Il peso: solo se BRT ha tassato un peso diverso da quello di Moove, ed è quanto quel peso cambia il prezzo del
    // listino. BRT arrotonda al chilo: 1,5 kg in Moove e 2 kg per BRT nella stessa fascia non cambiano niente.
    let peso = 0
    if (Math.abs(r.pesoTassato - pesoMoove) >= 0.001) {
      peso = r2(totG - totM)
      // Il motivo è quello che fa il peso tassato: se il volume supera il peso pesato, è il volume. Prima vinceva
      // sempre il peso pesato, e Wave leggeva "BRT ha pesato 4,9 kg, tassato 16 kg" (24/11): i 16 kg erano volume.
      const m3 = Math.max(r.volumeFatturare, r.volumeRilevato), volKg = m3 * 200
      const come = volKg > pesoMoove + 0.001 && volKg >= r.pesoRilevato - 0.001
        ? `misurato ${m3.toLocaleString('it-IT')} m³ (${kg(volKg)} kg di volume${r.pesoRilevato > 0 ? `, pesato ${kg(r.pesoRilevato)} kg` : ''})`
        : r.pesoRilevato > pesoMoove + 0.001 ? `pesato ${kg(r.pesoRilevato)} kg`
        : `tassato ${kg(r.pesoTassato)} kg`
      // BRT arrotonda (al kg fino a 100, ai 50 kg oltre): se l'arrotondamento cambia il peso, si dice.
      const arrot = Math.abs(r.pesoTassato - (r.pesoMisurato ?? r.pesoTassato)) > 0.001 && !come.startsWith('tassato') ? `, tassato ${kg(r.pesoTassato)} kg` : ''
      if (peso >= 0.01) motivi.push({ tipo: 'peso', importo: peso, gruppo: 'clienti', testo: `Moove ${kg(pesoMoove)} kg, BRT ha ${come}${arrot}: col tuo listino il prezzo sale da ${euro(totM)} a ${euro(totG)}.` })
      else if (peso <= -0.01) motivi.push({ tipo: 'peso', importo: peso, gruppo: 'listino', testo: `BRT ha tassato ${kg(r.pesoTassato)} kg, meno dei ${kg(pesoMoove)} kg di Moove: col tuo listino il prezzo scende da ${euro(totM)} a ${euro(totG)}.` })
      else peso = 0
    }

    // IL CARBURANTE. BRT lo calcola anche sopra le voci extra (sulla "i" da 6,90 € sono 0,86 € in più): quel carburante
    // appartiene alla voce, non al nolo, altrimenti un listino giusto sembrerebbe sotto costo. Se il listino dichiara una
    // percentuale e BRT ne mette di più, la parte in più sul nolo (e sulle isole, che il listino mette nel prezzo) è un
    // motivo a sé. Se il listino non la dichiara (carburante dentro il prezzo), sta nel confronto del totale.
    const { quota } = carburanteRigaBrt(r, legenda)
    const pctBrt = quota * 100
    // BRT scrive il carburante a tre decimali (0,513 su 4,10): la percentuale ricavata esce 12,51% per un 12,5%. A schermo
    // (e nella nota che raggruppa le righe di «Cosa allineare») si dice com'è, a un decimale.
    const pctBrtT = Math.round(pctBrt * 10) / 10
    const isoleBrt = vociPerCategoria.isole || 0
    const baseListino = r.nolo + isoleBrt
    const pctListino = listino.fuel_pct ?? (listino.nolo > 0 ? listino.fuel / listino.nolo * 100 : null)
    const dentro = carbDichiarato == null
    let carburante = 0
    if (!dentro && pctListino != null && pctBrt > pctListino + TOLLERANZA_CARBURANTE && baseListino > 0) {
      carburante = r2(baseListino * (pctBrt - pctListino) / 100)
      // Una zona senza carburante in un listino che altrove lo ha: è il listino che non lo ha, non BRT che sbaglia.
      if (carburante >= 0.01) motivi.push({ tipo: 'carburante', importo: carburante, gruppo: pctListino > 0 ? 'contestare' : 'listino',
        testo: pctListino > 0
          ? `Carburante: BRT ${pct(pctBrtT)} su ${euro(baseListino)}, il tuo listino ${pct(pctListino)}: ${euro(carburante)} in più.`
          : `Carburante: BRT ${pct(pctBrtT)} su ${euro(baseListino)}, il tuo listino per questa zona non ha carburante: ${euro(carburante)}.` })
      else carburante = 0
    }

    // Le voci che il listino non sa esprimere, ognuna col suo carburante. I servizi (assicurazione, appuntamento, GDO,
    // ritiro) a parte, qui sotto.
    let voci = 0
    const servizi: { nome: string; importo: number }[] = []
    for (const v of r.voci) {
      const d = descriviVoce(v.sigla, legenda)
      if (CATEGORIE_IN_LISTINO.has(d.categoria) || Math.abs(v.importo) < 0.005) continue
      if (d.categoria === 'servizio') { servizi.push({ nome: d.nome, importo: r2(v.importo * (d.sopraIlCarburante ? 1 : 1 + quota)) }); continue }
      const conCarburante = r2(v.importo * (d.sopraIlCarburante ? 1 : 1 + quota))
      voci += conCarburante
      const sopra = r2(conCarburante - v.importo)
      const brtVoce = `${euro(v.importo)}${sopra >= 0.01 ? ` + ${euro(sopra)} di carburante` : ''}`
      const prevista = d.voceListino ? prezziSupplemento.get(d.voceListino.toLowerCase()) : undefined
      if (!prevista) {
        motivi.push({ tipo: 'voce', importo: conCarburante, voce: d.nome, gruppo: gruppoVoceBrt(d), nota: notaVoceBrt(d, v.sigla),
          testo: `${d.nome} (sigla BRT "${v.sigla}"): ${brtVoce}, nel tuo listino non c'è${d.voceListino ? ` ("${d.voceListino}" vuoto nei supplementi del corriere, sezione Giacenze)` : ''}.` })
        continue
      }
      // Prevista dal listino: in creazione non si sapeva, quindi Moove non l'ha addebitata. Quel che il
      // listino non copre (di solito il carburante che BRT ci calcola sopra) resta una voce a parte, e la decide chi
      // paga: BRT chiede più del listino (contesto, o correggo il listino) o meno (correggo il listino, o va bene così).
      motivi.push({ tipo: 'supplemento', importo: prevista, voce: d.voceListino, gruppo: 'clienti',
        nota: `Prevista dal tuo listino (${euro(prevista)}): BRT la mette dopo la creazione, si gira a chi ha spedito.`,
        testo: `${d.voceListino} (sigla BRT "${v.sigla}"): ${euro(prevista)} dal tuo listino. In creazione non si sapeva: BRT lo mette dopo, va girato a chi ha spedito.` })
      const resto = r2(conCarburante - prevista)
      if (Math.abs(resto) >= 0.01) motivi.push({ tipo: 'voce', importo: resto,
        voce: `${d.voceListino}: ${resto > 0 ? 'BRT chiede più del tuo listino' : 'il tuo listino più alto di BRT'}`, gruppo: resto > 0 ? 'contestare' : 'listino',
        nota: `Nel tuo listino «${d.voceListino}» costa ${euro(prevista)}; BRT, col suo carburante, chiede ${resto > 0 ? 'di più' : 'di meno'}.`,
        testo: `${d.voceListino} (sigla BRT "${v.sigla}"): BRT chiede ${brtVoce}, il tuo listino ${euro(prevista)}: listino ${resto > 0 ? 'più basso' : 'più alto'} di ${euro(Math.abs(resto))}.` })
    }

    // I SERVIZI si chiedono in creazione e chi li chiede li paga lì, col suo listino: girarli di nuovo con la Rettifica
    // li farebbe pagare due volte (revisione del 27/11: un'assicurazione su 700 €, 4,73 € con il carburante, proposta
    // "da girare ai clienti"). Come per GLS: BRT contro il prezzo dei servizi nel listino del detentore (servizi chiesti e
    // assicurazione, già nel listino rifatto), e lo scarto si decide col listino. Un servizio che in Moove nessuno ha
    // chiesto si chiede a BRT (come l'«Entro ore 12» di GLS, che era un codice sbagliato).
    const brtServizi = r2(servizi.reduce((t, x) => t + x.importo, 0))
    const listinoServizi = r2(accG + Number(listino.assicurazione || 0))
    const chiesti = conServizi || Number(s.assicurazione || 0) > 0
    const residuoServizi = r2(brtServizi - listinoServizi)
    if (Math.abs(residuoServizi) >= 0.01) {
      const nomi = servizi.map(x => `${x.nome.toLowerCase()} ${euro(x.importo)}`).join(' + ')
      voci = r2(voci + residuoServizi)
      motivi.push(!chiesti && brtServizi > 0.005
        ? { tipo: 'voce', importo: residuoServizi, gruppo: 'chiarire', voce: 'Servizi che in Moove nessuno ha chiesto',
            nota: 'BRT ha fatto pagare un servizio (assicurazione, appuntamento, GDO, ritiro) che nella spedizione in Moove non è chiesto: chiedi a BRT perché, prima di pagarlo o girarlo.',
            testo: `Servizi BRT: ${nomi}, in Moove nessun servizio chiesto.` }
        : { tipo: 'voce', importo: residuoServizi, gruppo: 'listino', voce: `Servizi: ${residuoServizi > 0 ? 'BRT chiede più del tuo listino' : 'il tuo listino più alto di BRT'}`,
            nota: 'Il servizio chiesto in creazione costa a BRT una cifra diversa da quella del tuo listino: chi l\'ha chiesto l\'ha pagato col tuo listino.',
            testo: `Servizi: BRT ${brtServizi > 0.005 ? nomi : 'niente'}, il tuo listino ${euro(listinoServizi)}.` })
    }

    // GIÀ GIRATO CON LA RETTIFICA. Una rettifica confermata mette nel costo del detentore il peso e il supplemento che
    // il corriere ha fatto pagare (movimenti RIPFORN-), e li fa pagare a chi sta sotto. Rifacendo il controllo dopo,
    // quella parte della differenza non c'è più, ma peso e voce si calcolano dai pesi della spedizione e restavano: la
    // tariffa andava in negativo dello stesso importo (GLS, NI665520237 di Wave, 27/11). Wave il 24/11 ha girato così 25
    // differenze della BRT 74855. La parte rettificata si toglie dal peso e dalle voci da girare, in quest'ordine.
    // Ma la Rettifica porta anche in Moove il peso del corriere (peso_fatturato: la 067080439120519 di Wave è passata da 1
    // a 3,2 kg, con 0,20 € di RIPFORN): quella parte è già nel listino al peso di Moove e non copre niente. Prima copriva:
    // "Già girato 0,20 €" su un peso che il corriere tassa ancora di più, e un supplemento mai girato poteva sparire
    // coperto dal peso. Copre solo quello che il listino al peso di Moove non spiega.
    const giaNelPeso = Math.max(0, r2(totM - (moove - c.rettificato)))
    let coperto = r2(c.rettificato - Math.min(c.rettificato, giaNelPeso)), copertoVoci = 0, copertoPeso = 0
    if (coperto > 0.005) {
      for (const m of [...motivi.filter(x => x.gruppo === 'clienti' && x.tipo === 'peso'), ...motivi.filter(x => x.gruppo === 'clienti' && x.tipo !== 'peso')]) {
        if (coperto <= 0.005 || m.importo <= 0.005) continue
        const togli = r2(Math.min(m.importo, coperto))
        m.importo = r2(m.importo - togli); coperto = r2(coperto - togli)
        if (m.tipo === 'peso') { peso = r2(peso - togli); copertoPeso = r2(copertoPeso + togli) } else { voci = r2(voci - togli); copertoVoci = r2(copertoVoci + togli) }
        m.testo += ` Già girat${m.tipo === 'peso' ? 'o' : 'a'} con la Rettifica: ${euro(togli)}.`
      }
      for (let i = motivi.length - 1; i >= 0; i--) if (Math.abs(motivi[i].importo) < 0.01 && motivi[i].tipo !== 'tariffa') motivi.splice(i, 1)
    }

    const tariffa = r2(differenza - peso - carburante - voci)
    // Il costo registrato portato al peso di BRT, senza i supplementi già girati (stanno nel costo ma non nel listino).
    const mooveAlPeso = r2(moove + peso - copertoVoci)
    const brtTariffa = r2(mooveAlPeso + tariffa)           // quanto chiede BRT senza voci e carburante in più
    const scartoListino = r2(brtTariffa - totG)            // BRT contro il listino di oggi, stesso peso
    // «Il listino è cambiato dopo» si guarda sul costo al peso di Moove, senza quello che la Rettifica ha coperto (il
    // supplemento girato, e il peso se il peso in Moove è rimasto quello di prima). Col solo «meno le rettifiche», ogni
    // spedizione rettificata diceva "il tuo listino è cambiato dopo" anche col listino mai toccato (067007439120503).
    const cambiato = Math.abs(totM - (moove - copertoVoci - copertoPeso)) >= 0.01
    // Isola minore sì o no: BRT e il listino possono vederla diversa sullo stesso CAP (80070 è Bacoli, terraferma, e
    // comuni di Ischia; 30126 è Venezia Lido). Fattura 74855 di Wave, 24/11: Barano d'Ischia isola per BRT (8 €) e
    // Italia per Moove, Bacoli il contrario. Detto così si sa cosa sistemare: la zona, non il prezzo. Solo la "J"
    // (isole minori): la "g" è il traghetto di Sicilia e Sardegna, che nel listino hanno la loro zona.
    const isolaBrt = r.voci.some(v => v.sigla === 'J' && v.importo > 0.005)
    const isolaListino = /isol|venezia|lagun/i.test(listino.zona || '')
    const dove = `${s.dest_cap || r.cap} ${s.dest_citta || r.localita}`
    const zone = isolaBrt && !isolaListino
      ? `BRT l'ha trattata come isola minore (${euro(r.voci.filter(v => v.sigla === 'J').reduce((t, v) => t + v.importo, 0))}), il tuo listino come ${listino.zona || 'Italia'}: in Moove ${dove} non cade nella zona isole.`
      : !isolaBrt && isolaListino
        ? `Il tuo listino l'ha trattata come ${listino.zona}, BRT no: per BRT ${dove} non è un'isola.`
        : ''
    if (Math.abs(tariffa) >= 0.01) {
      const cosa = `nolo ${euro(r.nolo)} + carburante ${pct(pctBrtT)}${isoleBrt > 0.005 ? ', isole' : ''}${(vociPerCategoria.contrassegno || 0) > 0.005 ? ', contrassegno' : ''}`
      motivi.push({ tipo: 'tariffa', importo: tariffa, gruppo: 'listino', testo: `A parità di peso BRT chiede ${euro(brtTariffa)} (${cosa}), in Moove il costo registrato è ${euro(mooveAlPeso)}`
        + (cambiato ? `. Il tuo listino è cambiato dopo: oggi direbbe ${euro(totG)}${Math.abs(scartoListino) < 0.01 ? ', come BRT' : ''}.` : tariffa > 0 ? ': listino più basso del vero.' : ': listino più alto del vero.')
        + (zone ? ' ' + zone : '') })
    }

    // Lo scarto col listino di oggi, voce per voce (lib/fattura-gls, AllineaGls). Le parti di una riga sommano lo
    // scarto: quello che nolo e contrassegno non spiegano va in "altro". Sotto i 5 centesimi è arrotondamento, e resta
    // sulla prima parte. Col carburante dentro il prezzo il nolo di BRT si confronta col suo carburante (4,10 € al
    // 12,5% = 4,61 €, contro i 4,60 € del listino); con una percentuale nel listino, senza.
    const parti: ParteAllinea[] = []
    if (Math.abs(scartoListino) >= 0.01) {
      const pctL = dentro ? 0 : (pctListino ?? 0)
      const brtNolo = r2(baseListino * (dentro ? 1 + quota : 1))
      if (Math.abs(brtNolo - listino.nolo) >= 0.01) {
        const nota = [dentro ? `${euro(r.nolo)}${isoleBrt > 0.005 ? ` + ${euro(isoleBrt)} di isole` : ''} + carburante ${pct(pctBrtT)}` : '', zone].filter(Boolean).join('. ')
        parti.push({ voce: 'nolo', listino: r2(listino.nolo), gls: brtNolo, euro: r2((brtNolo - listino.nolo) * (1 + pctL / 100)), ...(nota ? { nota } : {}) })
      }
      const brtCod = r2(vociPerCategoria.contrassegno || 0)
      const lCod = r2(Number(listino.contrassegno || 0))
      if (Math.abs(brtCod - lCod) >= 0.01) {
        // BRT: il contrassegno è l'1,5% dell'incasso con un minimo di 1,29 € (86 righe su 86, lib/fattura-brt): sopra
        // gli 86 € l'importo cambia a ogni spedizione. Si somma per regola, non per importo.
        const cod = Number(s.contrassegno || 0)
        const percentuale = cod > 0 && brtCod > 1.295 && Math.abs(brtCod - cod * 0.015) < 0.011
        parti.push({ voce: 'contrassegno', listino: lCod, gls: brtCod, euro: r2(brtCod - lCod), ...(percentuale ? { regola: "l'1,5% dell'incasso (minimo 1,29 €)" } : {}) })
      }
      const resto = r2(scartoListino - parti.reduce((t, p) => t + p.euro, 0))
      if (parti.length && Math.abs(resto) < 0.05) parti[0].euro = r2(parti[0].euro + resto)
      else if (Math.abs(resto) >= 0.05) parti.push({ voce: 'altro', listino: totG, gls: brtTariffa, euro: resto })
    }
    // Il carburante che il listino non ha in quella zona (e altrove sì): non è nello scarto, è un motivo a sé, ma è il
    // listino che va sistemato.
    if (carburante >= 0.01 && pctListino != null && !(pctListino > 0)) parti.push({ voce: 'carburante', listino: 0, gls: pctBrtT, euro: carburante })
    const allinea: AllineaGls | undefined = parti.length
      ? { listino: nomeContratto, zona: listino.zona || '', peso: r.pesoTassato, luogo: [s.dest_citta || r.localita, s.dest_cap || r.cap].filter(Boolean).join(' '), parti }
      : undefined
    return { ...conSped, moove, listino, differenza, motivi, scartoListino, ...(allinea ? { allinea } : {}) }
  })
}
