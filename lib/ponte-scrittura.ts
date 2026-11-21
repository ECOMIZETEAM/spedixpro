import { createAdminSupabase } from '@/lib/supabase-admin'
import { valutaLivelloV1 } from '@/lib/v1-livello'
import {
  corpoPerIlVenditoreV1, rigaV1, parametriAlberoV1, parametriCatenaV1, pressoDelCorpo, colliDelCorpo, ritiroDelCorpo,
} from '@/lib/v1-riga'
import { modalitaCodPosteV1 } from '@/lib/v1-poste'
import { movimentiAlbero } from '@/lib/condivisione-catena'
import { movimentiCatena, type MovimentoMaster } from '@/lib/cascata'
import { descrizioneSpedizione } from '@/lib/movimenti'
import { modalitaCodDaRichiesta, type ModalitaCod } from '@/lib/contrassegno-modalita'
import { ritiroInRisposta } from '@/lib/ritiro-api'
import { mimeDaiByte } from '@/lib/moovexpress'
import type { LivelloPonte } from '@/lib/ponte-unico'

// LA SCRITTURA UNICA DEI CONDIVISI (fase 3 di PONTE-UNICO.md): il piano di tutto quello che la staffetta scrive, per
// ogni livello della fila e per la riga del cliente, pronto per una transazione sola (scripts/ponte-unico-scrittura.sql,
// ponte_scrivi).
//
// Niente qui decide un prezzo o una regola: ogni pezzo viene dalla stessa funzione che usa la staffetta. La richiesta
// a ogni livello (corpoPerIlVenditoreV1), la riga di ogni livello (rigaV1), gli addebiti d'albero e del detentore
// (movimentiAlbero, movimentiCatena), le descrizioni (descrizioneSpedizione). Qui si mettono in fila come le
// metterebbe la staffetta: dal detentore in su, ogni livello con la risposta di quello sotto.
//
// Il piano si prepara PRIMA di comprare la lettera di vettura, col numero in sospeso: e' quello che si annota nel
// registro del lavoro in corso. Arrivata la LDV, completaPiano mette numero, etichetta e risposta del corriere al
// loro posto, senza ricalcolare niente: anche il recupero di un processo morto scrive esattamente quel piano.

type Admin = ReturnType<typeof createAdminSupabase>
export type ValutazioneV1 = Exclude<Awaited<ReturnType<typeof valutaLivelloV1>>, Response>

// I segnaposto del piano prima della LDV. Non possono comparire in un dato vero.
export const SEGNO_LDV = '§LDV§'
export const SEGNO_ETICHETTA = '§ETICHETTA§'          // l'etichetta come la salva il detentore
export const SEGNO_ETICHETTA_SU = '§ETICHETTA_SU§'    // come la salvano i livelli sopra e la riga del cliente
export const SEGNO_RAW = '§RAW§'                      // la risposta del corriere sulla riga del detentore

export type OpPonte =
  | { op: 'spedizione'; riga: Record<string, any> }
  | { op: 'conferma'; riferimento: string; spedizione_id: string; descrizione: string; importo_finale: number; riferimento_finale: string; master_id: string; cliente_id: string }
  | { op: 'cliente'; tipo: string; master_id: string; cliente_id: string; descrizione: string; importo: number; riferimento: string | null; spedizione_id: string | null; created_by: string | null }
  | { op: 'master'; tipo: string; owner: string; target: string; descrizione: string; importo: number; riferimento: string | null; spedizione_id: string | null; created_by: string | null }
  | { op: 'prenota'; livello: number; master_id: string; cliente_id: string; descrizione: string; importo: number; riferimento: string; created_by: string | null }

export const opMaster = (m: MovimentoMaster): OpPonte => ({
  op: 'master', tipo: m.tipo, owner: m.masterOwnerId, target: m.masterTargetId, descrizione: m.descrizione,
  importo: Number(m.importo), riferimento: m.riferimento ?? null, spedizione_id: m.spedizioneId ?? null, created_by: m.createdBy ?? null,
})

// La richiesta come la legge il venditore: JSON, quindi senza i campi undefined.
const comeJson = (x: any) => JSON.parse(JSON.stringify(x))

// LA RICHIESTA A OGNI LIVELLO DELLA FILA. La prima e' quella della creazione; ognuna delle altre e' quella che il
// livello sopra manda al suo venditore (corpoPerIlVenditoreV1, con il «c/o» che la staffetta aggiunge a ogni salto).
// Dipende solo dalla richiesta: si compone tutta subito, e i livelli si valutano insieme.
export function richiesteDellaFila(prima: any, livelli: number): any[] {
  const corpi = [comeJson(prima)]
  for (let k = 1; k < livelli; k++) {
    const b = corpi[k - 1]
    corpi.push(comeJson(corpoPerIlVenditoreV1({ body: b, packages: colliDelCorpo(b), ...pressoDelCorpo(b), ...ritiroDelCorpo(b) })))
  }
  return corpi
}

// L'etichetta che un livello salva, presa da quella del livello sotto come gliela serve /api/v1/shipments/[id]/label
// (al conto d'ingrosso: gli stessi byte, verificato il 21/11 su 100 pacchi, un'etichetta sola in tutte le righe), col
// tipo letto dai byte come lib/moovexpress (etichettaMoovexpress). Senza etichetta sotto, nemmeno sopra.
export function etichettaDalSotto(sotto: string | null): string | null {
  if (!sotto) return null
  if (sotto === SEGNO_ETICHETTA || sotto === SEGNO_ETICHETTA_SU) return SEGNO_ETICHETTA_SU
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(sotto)
  if (!m) return null
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length) return null
  return `data:${mimeDaiByte(buf) || m[1] || 'application/pdf'};base64,${buf.toString('base64')}`
}

// Un livello della fila pronto per la scrittura: chi e', la richiesta che riceve, i suoi controlli e prezzo, l'id della
// sua riga (deciso prima) e la sua prenotazione del credito, se c'e'.
export type LivelloDaScrivere = {
  l: LivelloPonte
  body: any
  v: ValutazioneV1
  id: string
  prenotazione: string | null
}

// Cosa il livello sotto risponde a quello sopra (la risposta di /api/v1/shipments letta da lib/moovexpress).
type Esito = {
  numero: string; costoCorrente: number; codModeUsata: ModalitaCod | null; etichettaUrl: string | null; raw: any
  ritiroPrenotato: boolean; codiceRitiro: string | null
}
function rispostaAlLivelloSopra(sotto: LivelloDaScrivere, es: Esito) {
  const j = comeJson({
    id: sotto.id, tracking: es.numero, prezzo: sotto.v.costoCliente, label_url: `/api/v1/shipments/${sotto.id}/label`,
    ...(es.codModeUsata ? { codMode: es.codModeUsata } : {}),
    ...(sotto.v._vuoleRitiro ? { ritiro: ritiroInRisposta({
      prenotato: es.ritiroPrenotato, data: sotto.v._dataRitiro, intervallo: sotto.v._pomeriggio ? '14:00-18:00' : '09:00-13:00',
      codice: es.codiceRitiro, tipo: sotto.v.corriere.tipo, spedizioneId: sotto.id,
    }) } : {}),
  })
  return {
    id: String(j.id || ''), tracking: String(j.tracking), prezzo: Number(j.prezzo) || 0, label_url: String(j.label_url || ''),
    ritiro: j.ritiro, codMode: j.codMode ? String(j.codMode) : undefined,
  }
}

// IL PIANO DELLA FILA, prima della LDV. `livelli` dal primo venditore (sotto la riga del cliente) al detentore, che
// compra la LDV sul contratto vero (oggi solo Poste: SDA EXPRESS L). Restituisce le operazioni nell'ordine della
// staffetta (dal detentore in su) e la risposta del primo venditore, che la creazione usa per la riga del cliente.
export async function pianoDellaFila(admin: Admin, livelli: LivelloDaScrivere[]): Promise<{
  ops: OpPonte[]
  nonAddebitati: string[]
  risposta: ReturnType<typeof rispostaAlLivelloSopra>
  etichettaPerOrigine: string | null
}> {
  const n = livelli.length
  if (!n) throw new Error('PONTE: fila vuota')
  const det = livelli[n - 1]
  if (det.v.corriere.tipo !== 'poste') throw new Error(`PONTE: detentore su un contratto ${det.v.corriere.tipo}, non previsto`)
  for (const L of livelli) {
    // Ogni livello e' il conto d'ingrosso di chi compra: la staffetta non prenota ritiri ne' salva il dettaglio colli
    // su queste righe. Se un giorno non fosse cosi', il piano non saprebbe riprodurla: meglio la staffetta.
    if (L.v.cliente?.ledger !== true) throw new Error('PONTE: livello senza conto d\'ingrosso, non previsto')
  }

  // Dal basso: cosa ogni livello sa quando scrive la sua riga.
  const esiti: Esito[] = new Array(n)
  esiti[n - 1] = {
    numero: SEGNO_LDV, costoCorrente: 0, codModeUsata: modalitaCodPosteV1(det.v.corriere, det.body),
    etichettaUrl: SEGNO_ETICHETTA, raw: SEGNO_RAW, ritiroPrenotato: false, codiceRitiro: null,
  }
  for (let k = n - 2; k >= 0; k--) {
    const L = livelli[k]
    const r = rispostaAlLivelloSopra(livelli[k + 1], esiti[k + 1])
    const ritiroPrenotato = L.v._vuoleRitiro && r.ritiro?.richiesto === true
    const codiceRitiro = r.ritiro?.codice || null
    esiti[k] = {
      numero: r.tracking, costoCorrente: r.prezzo, codModeUsata: modalitaCodDaRichiesta(r.codMode),
      etichettaUrl: etichettaDalSotto(esiti[k + 1].etichettaUrl), ritiroPrenotato, codiceRitiro,
      raw: { _moovexpress: true, tracking: r.tracking, venditore_spedizione_id: r.id || null, label_url: r.label_url || null, _ritiroPrenotato: ritiroPrenotato, _codiceRitiro: codiceRitiro },
    }
  }

  // Gli addebiti di ogni livello: letture dei listini, tutte insieme. Su un ponte i livelli d'albero del venditore,
  // sul contratto vero la cascata del detentore col costo del corriere (come la rotta, lib/v1-riga).
  const addebiti = await Promise.all(livelli.map((L, k) => {
    const es = esiti[k]
    const base = { masterId: L.v.masterId, corriere: L.v.corriere, body: L.body, packages: L.v.packages, numero: es.numero, spedizioneId: L.id }
    return L.v.corriere.tipo === 'moovexpress'
      ? movimentiAlbero(admin, parametriAlberoV1(base))
      : movimentiCatena(admin, parametriCatenaV1({ ...base, costoCorrente: es.costoCorrente })).then(movimenti => ({ movimenti, nonAddebitati: [] as string[] }))
  }))

  const ops: OpPonte[] = []
  for (let k = n - 1; k >= 0; k--) {
    const L = livelli[k], es = esiti[k]
    const { riga } = rigaV1({
      cliente: L.v.cliente, ctx: { clienteId: L.l.clienteId }, numero: es.numero, masterId: L.v.masterId, corriere: L.v.corriere,
      body: L.body, pressoFrom: L.v.pressoFrom, pressoTo: L.v.pressoTo, puntoConsegna: L.v.puntoConsegna, packages: L.v.packages,
      pesoReale: L.v.pesoReale, ris: L.v.ris, pkg: L.v.pkg, codModeUsata: es.codModeUsata, etichettaUrl: es.etichettaUrl,
      colliDettaglio: null, raw: es.raw, costoCorrente: es.costoCorrente, costoCliente: L.v.costoCliente,
      ritiroPrenotato: es.ritiroPrenotato, _dataRitiro: L.v._dataRitiro, _pomeriggio: L.v._pomeriggio,
    })
    ops.push({ op: 'spedizione', riga: comeJson({ id: L.id, ...riga }) })
    // Il conto d'ingrosso paga il venditore: la prenotazione diventa l'addebito, o l'addebito si fa adesso.
    const descrizione = descrizioneSpedizione(es.numero, L.body.shipTo?.name)
    if (L.prenotazione) {
      ops.push({ op: 'conferma', riferimento: L.prenotazione, spedizione_id: L.id, descrizione, importo_finale: Math.abs(L.v.costoCliente), riferimento_finale: es.numero, master_id: L.v.masterId, cliente_id: L.l.clienteId })
    } else if (L.v.costoCliente > 0) {
      ops.push({ op: 'cliente', tipo: 'spedizione', master_id: L.v.masterId, cliente_id: L.l.clienteId, descrizione, importo: -Math.abs(L.v.costoCliente), riferimento: es.numero, spedizione_id: L.id, created_by: null })
    }
    for (const m of addebiti[k].movimenti) ops.push(opMaster(m))
  }

  return {
    ops,
    nonAddebitati: addebiti.flatMap(a => a.nonAddebitati),
    risposta: rispostaAlLivelloSopra(livelli[0], esiti[0]),
    etichettaPerOrigine: etichettaDalSotto(esiti[0].etichettaUrl),
  }
}

// Le prenotazioni del credito dei conti d'ingrosso, come le fa la rotta (registraMovimento con capienza): solo sui conti
// a credito e con un prezzo. In ponte_prenota tutte insieme, tutto o niente.
export function prenotazioniDellaFila(livelli: LivelloDaScrivere[]): Extract<OpPonte, { op: 'prenota' }>[] {
  const out: Extract<OpPonte, { op: 'prenota' }>[] = []
  livelli.forEach((L, k) => {
    if (!L.prenotazione) return
    out.push({
      op: 'prenota', livello: k + 1, master_id: L.v.masterId, cliente_id: L.l.clienteId,
      descrizione: `Prenotazione ${String(L.body.shipTo?.name || '').slice(0, 40)}`.trim(),
      importo: -Math.abs(L.v.costoCliente), riferimento: L.prenotazione, created_by: null,
    })
  })
  return out
}
// Chi va prenotato: la stessa condizione della rotta.
export const vaPrenotato = (v: ValutazioneV1) => v.cliente?.tipo_contratto === 'credito_scalare' && v.costoCliente > 0

// IL PIANO COMPLETO, ARRIVATA LA LDV. Solo sostituzioni: il numero dentro ogni testo, l'etichetta e la risposta del
// corriere al loro posto. L'etichetta dei livelli sopra e' quella del detentore riletta come la rilegge la staffetta.
export function completaPiano<T>(piano: T, ldv: { numero: string; etichettaUrl: string | null; raw: any }): T {
  if (!ldv.numero || ldv.numero.includes('§')) throw new Error('PONTE: LDV non valida')
  const su = etichettaDalSotto(ldv.etichettaUrl)
  const giro = (x: any): any => {
    if (typeof x === 'string') {
      if (x === SEGNO_ETICHETTA) return ldv.etichettaUrl
      if (x === SEGNO_ETICHETTA_SU) return su
      if (x === SEGNO_RAW) return ldv.raw
      return x.includes(SEGNO_LDV) ? x.split(SEGNO_LDV).join(ldv.numero) : x
    }
    if (Array.isArray(x)) return x.map(giro)
    if (x && typeof x === 'object') { const o: any = {}; for (const k of Object.keys(x)) o[k] = giro(x[k]); return o }
    return x
  }
  const fatto = giro(piano)
  // Nessun segnaposto deve sopravvivere: vorrebbe dire un pezzo del piano non completato.
  const testo = JSON.stringify(fatto)
  if ([SEGNO_LDV, SEGNO_ETICHETTA, SEGNO_RAW].some(s => testo.includes(s))) throw new Error('PONTE: piano non completato')
  return fatto
}

// L'ADDEBITO A CHI HA CREATO, come lo fa la creazione dal portale (addebitaCredito in app/api/spedizioni/crea), in
// operazioni per la transazione. Spedizione propria del master: niente qui. Per conto di un sotto-master: il suo
// credito. Cliente: la prenotazione diventa l'addebito, o l'addebito si fa adesso. Stesse descrizioni e riferimenti.
// Se la conferma non trovasse la prenotazione (liberata nel frattempo), ponte_scrivi addebita lo stesso: la creazione
// in quel caso ripiegava sull'addebito normale.
export function opsAddebitoClientePortale(p: {
  isProprio: boolean; masterSub: string | null; prenotazioneRif: string | null; costo: number
  masterId: string; clienteId: string | null; numeroSped: string; destNome: string | null | undefined
  spedizioneId: string; userId: string | null
}): OpPonte[] {
  const descrizione = `${p.numeroSped} - ${p.destNome || ''}`.trim()
  if (p.isProprio) return []
  if (p.masterSub) {
    if (!(p.costo > 0)) return []
    return [{ op: 'master', tipo: 'spedizione', owner: p.masterId, target: p.masterSub, descrizione, importo: -Math.abs(p.costo), riferimento: p.numeroSped, spedizione_id: p.spedizioneId, created_by: p.userId }]
  }
  if (!(p.costo > 0) || !p.clienteId) return []
  if (p.prenotazioneRif) {
    return [{ op: 'conferma', riferimento: p.prenotazioneRif, spedizione_id: p.spedizioneId, descrizione, importo_finale: Math.abs(p.costo), riferimento_finale: p.numeroSped, master_id: p.masterId, cliente_id: p.clienteId }]
  }
  return [{ op: 'cliente', tipo: 'spedizione', master_id: p.masterId, cliente_id: p.clienteId, descrizione, importo: -Math.abs(p.costo), riferimento: p.numeroSped, spedizione_id: p.spedizioneId, created_by: p.userId }]
}
