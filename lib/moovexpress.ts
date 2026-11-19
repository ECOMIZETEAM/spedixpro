/* Integrazione "moovexpress": un master RIVENDE il contratto di un altro master (vedi
 * CONDIVISIONE-CONTRATTI.md). Quando il COMPRATORE spedisce su un corriere tipo='moovexpress', questo
 * client chiama l'`/api/v1` del VENDITORE con la api_key del collegamento (nasce quando il venditore gli
 * condivide il contratto, sta dentro corrieri.credenziali):
 * il venditore crea la spedizione VERA sul suo contratto (smistando al fornitore reale — spedisci/brt/…)
 * e torna numero + etichetta + prezzo. Il `prezzo` è ciò che il venditore addebita al compratore-ledger
 * = il COSTO per il compratore (W). È lo stesso schema degli altri provider (lib/spedisci, lib/brt…), ma
 * il "fornitore" è un altro portale MoovExpress raggiunto via HTTP — così il confine è già un'API il
 * giorno che i portali diventeranno domìni separati.
 *
 * NON tocca la contabilità: qui si parla solo con l'API. Il costo/ricavo lo registra il flusso di
 * creazione del compratore (addebitaCatena col prezzo tornato qui), come per ogni altro provider.
 */

import { MSG_PONTE_NON_CONCLUSO } from '@/lib/errore-corriere'

export type MoovexpressCred = {
  api_key: string
  base_url?: string           // API del venditore; oggi lo stesso portale, domani un dominio suo
  fornitore_master_id?: string
  corriere_origine_id?: string
}

// I TEMPI DEL PONTE. Ogni salto (portale → Wave → LOGIXIA → Poste) e' una funzione con lo stesso tetto di
// durata, e nessuno diceva al venditore quanto tempo restava a chi lo chiamava. Quando il database
// rallentava, chi stava in alto moriva per primo mentre quelli sotto finivano il lavoro: la LDV nasceva e le
// gambe d'ingrosso venivano addebitate, ma la spedizione del cliente no. Dal 2 al 9/11/2026 e' successo 19
// volte su SDA EXPRESS L. Wave ha pagato a LOGIXIA 110,50 € e MULTI ha pagato a Wave 56,20 €, senza
// nessuna spedizione da vendere. Esempio: il 9/11 la prenotazione di Wave presso LOGIXIA e' nata alle
// 12:20:54 ora italiana, un secondo prima che Wave morisse. LOGIXIA non poteva saperlo e alle 12:20:58 ha
// creato la LDV 282343J064551.
// Ora chi chiama dice quanto tempo gli resta (PONTE_HDR_TEMPO) e il venditore non parte se non fa in tempo.
// Ogni richiesta ha un codice (PONTE_HDR_RICHIESTA): se la risposta non arriva, prima di dire «non creata»
// si chiede al venditore com'e' andata.
export const PONTE_HDR_TEMPO = 'x-moovexpress-tempo-ms'
export const PONTE_HDR_RICHIESTA = 'x-moovexpress-richiesta'
// Al compratore, dopo la risposta: scaricare l'etichetta, scrivere la riga, addebitare.
const MARGINE_DOPO_MS = 25_000
// Per chiedere al venditore com'e' andata quando la risposta non arriva.
const MARGINE_VERIFICA_MS = 8_000
// Sotto questo tempo il venditore non fa in tempo: non lo si chiama nemmeno.
const MINIMO_VENDITORE_MS = 15_000
// Il venditore non chiama il corriere se a chi lo chiama resta meno di cosi'.
export const MINIMO_CREAZIONE_MS = 10_000

// Fino a quando questa richiesta puo' lavorare: il proprio tetto, o meno se chi chiama ha detto di avere
// meno tempo (e' il salto di sopra del ponte). `t0` = il primo istante della rotta.
export function scadenzaRichiesta(req: Request, t0: number, maxDurationS: number): number {
  const propria = t0 + maxDurationS * 1000 - 3_000
  const dichiarato = Number(req.headers.get(PONTE_HDR_TEMPO))
  return Number.isFinite(dichiarato) && dichiarato > 0 ? Math.min(propria, t0 + dichiarato) : propria
}

// La spedizione non e' nata dalla parte di chi spedisce: il credito torna. Se dal venditore e' nata lo
// stesso, la sentinella (lib/ponte-orfane) annulla le sue gambe.
export class PonteNonConcluso extends Error {
  constructor() { super(MSG_PONTE_NON_CONCLUSO); this.name = 'PonteNonConcluso' }
}

// Base dell'API del venditore. Oggi loopback sullo stesso portale; si può fissare per-contratto
// (cred.base_url) o via env, con default al dominio di produzione.
function baseUrl(cred: MoovexpressCred): string {
  const b = cred.base_url || process.env.MOOVEXPRESS_API_BASE || process.env.APP_URL || 'https://moovexpress.com'
  return b.replace(/\/+$/, '')
}

export type MoovexpressPacco = { weight: number; length?: number; width?: number; height?: number }
export type MoovexpressCreaInput = {
  packages: MoovexpressPacco[]
  shipFrom: Record<string, any>
  shipTo: Record<string, any>
  codValue?: number
  // Contanti o assegno (C / AB / AC): la decide chi spedisce, la usa il contratto vero che sta dal
  // venditore. Su SDA EXPRESS L e' cio' che fa partire il contrassegno con assegno (lib/contrassegno-modalita).
  incassoModalita?: string
  insuranceValue?: number
  notes?: string
  contenuto?: string
  // Riferimento ordine e valore merce: il VENDITORE li usa come un'integrazione qualsiasi (numRif,
  // supplemento contrassegno/assicurazione dal suo listino). Passarli = il prezzo W torna completo.
  rifOrdine?: string
  valoreMerce?: number
  pickup?: { requested: boolean; date?: string; time?: string }
  // Consegna a un punto: il punto (e il tipo di deposito dei contratti PuntoPoste) li sceglie chi
  // spedisce, ma li usa il contratto vero, che sta dal venditore. Si passano cosi' come sono arrivati.
  deliveryPoint?: unknown
  dropoffType?: string
  inpostPointId?: string
}
export type MoovexpressCreaResult = {
  id: string           // id della spedizione DAL LATO VENDITORE (per scaricare l'etichetta)
  tracking: string
  prezzo: number       // W: quanto il venditore addebita al compratore (= costo per il compratore)
  label_url: string    // relativo: /api/v1/shipments/<id>/label
  ritiro?: any
  codMode?: string     // CON / ABM / ACM: come il corriere incassera' il contrassegno (solo contratti Poste)
}

export type MoovexpressQuotaInput = {
  packages: MoovexpressPacco[]
  shipTo: Record<string, any>
  codValue?: number
  insuranceValue?: number
}
export type MoovexpressQuota = {
  contratto: string | null
  zona: any
  peso_fatturato: number
  nolo: number
  prezzo: number       // W: il costo per il compratore
  valuta: string
  [k: string]: any
}

// PREVENTIVO (a costo zero, nessuna spedizione creata): chiede al venditore la tariffa del contratto
// per una destinazione. Serve a verificare il ponte (la key funziona, torna W) senza spendere
// un'etichetta, e più avanti a quotare/costruire il prezzo di vendita del compratore.
export async function quotaMoovexpress(cred: MoovexpressCred, dati: MoovexpressQuotaInput): Promise<MoovexpressQuota> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/rates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.api_key}` },
      body: JSON.stringify(dati),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  return j as MoovexpressQuota
}

const comeRisultato = (j: any): MoovexpressCreaResult => ({
  id: String(j.id || ''), tracking: String(j.tracking), prezzo: Number(j.prezzo) || 0, label_url: String(j.label_url || ''), ritiro: j.ritiro,
  codMode: j.codMode ? String(j.codMode) : undefined,
})

// Crea la spedizione sul contratto del venditore. Lancia un Error col messaggio del fornitore se la rifiuta,
// e PonteNonConcluso se non si riesce a sapere com'e' andata. `scadenza` = fino a quando chi chiama puo'
// lavorare (scadenzaRichiesta).
//
// Un 4xx e' un rifiuto vero: la spedizione non c'e'. Un 5xx (il 504 di quando il venditore muore), una
// risposta che non arriva o un 200 senza numero NON dicono "non creata". Prima si leggevano tutti come un
// rifiuto e il credito tornava al cliente, mentre la LDV e le gambe sotto restavano addebitate.
export async function creaSpedizioneMoovexpress(
  cred: MoovexpressCred, dati: MoovexpressCreaInput, opz: { scadenza?: number } = {},
): Promise<MoovexpressCreaResult> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  const scadenza = opz.scadenza ?? Date.now() + 57_000
  const tempo = scadenza - Date.now() - MARGINE_DOPO_MS - MARGINE_VERIFICA_MS
  if (tempo < MINIMO_VENDITORE_MS) {
    // Non si chiama: il venditore creerebbe una LDV che qui nessuno farebbe in tempo a registrare.
    console.error('[PONTE] tempo finito prima di chiamare il venditore', { restano_ms: scadenza - Date.now() })
    throw new PonteNonConcluso()
  }
  const codice = crypto.randomUUID()
  let r: Response | null = null
  let j: any = {}
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/shipments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${cred.api_key}`,
        [PONTE_HDR_RICHIESTA]: codice,
        // Un secondo in meno per il viaggio della richiesta.
        [PONTE_HDR_TEMPO]: String(tempo - 1_000),
      },
      body: JSON.stringify(dati),
      signal: AbortSignal.timeout(tempo),
    })
    j = await r.json().catch(() => ({}))
  } catch (e: any) {
    console.error('[PONTE] risposta del venditore non arrivata', codice, e?.name || '', e?.message || '')
    r = null
  }
  if (r && r.status < 500) {
    if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
    if (j?.tracking) return comeRisultato(j)
  }

  // ESITO INCERTO: si chiede al venditore cosa e' successo a questa richiesta, per pochi secondi. Il
  // venditore ha la stessa scadenza della nostra attesa, quindi quando smettiamo di aspettare ha gia'
  // finito o rinunciato. Se ha risposto con un 5xx, chi lo ha servito e' gia' morto.
  const esito = await verificaRichiesta(cred, codice, Math.min(scadenza - MARGINE_DOPO_MS, Date.now() + MARGINE_VERIFICA_MS))
  if (esito.stato === 'fatta' && esito.risposta?.tracking) {
    // E' nata: la si tiene. E' la stessa richiesta (stessi pesi, stesso contrassegno), e il cliente non
    // vede un errore su una spedizione che esiste.
    console.warn('[PONTE] risposta persa ma spedizione nata dal venditore: adottata', codice, esito.risposta.tracking, r ? `http ${r.status}` : 'nessuna risposta')
    return comeRisultato(esito.risposta)
  }
  if (esito.stato === 'fallita') throw new Error(esito.risposta?.error || `Errore dal fornitore (${esito.risposta?.status || r?.status || '—'})`)
  console.error('[PONTE] esito non concluso', codice, esito.stato, r ? `http ${r.status}` : 'nessuna risposta')
  throw new PonteNonConcluso()
}

// Com'e' andata una richiesta del ponte, chiesto al venditore (GET /api/v1/shipments?richiesta=<codice>).
// 'fatta' e 'fallita' sono definitive. 'in_corso' vuol dire che il venditore sta ancora lavorando, quindi si
// richiede finche' c'e' tempo. 'assente' vuol dire che non risulta registrata.
// Nessuna delle due dice che non e' nata: la registrazione poteva essere fallita con il database lento.
async function verificaRichiesta(cred: MoovexpressCred, codice: string, finoA: number): Promise<{ stato: string; risposta?: any }> {
  let ultimo: { stato: string; risposta?: any } = { stato: 'ignoto' }
  let assente = 0
  while (finoA - Date.now() > 1_000) {
    try {
      const r = await fetch(`${baseUrl(cred)}/api/v1/shipments?richiesta=${encodeURIComponent(codice)}`, {
        headers: { Authorization: `Bearer ${cred.api_key}` },
        signal: AbortSignal.timeout(Math.min(5_000, finoA - Date.now())),
      })
      const j: any = await r.json().catch(() => ({}))
      if (r.status === 404 && j && 'richiesta' in j) {
        ultimo = { stato: 'assente' }
        // Due volte di fila: non arrivera' (la richiesta non e' giunta, o il registro non si e' scritto).
        if (++assente >= 2) return ultimo
      } else if (r.ok && j?.richiesta?.stato) {
        ultimo = { stato: String(j.richiesta.stato), risposta: j.richiesta.risposta }
        if (ultimo.stato === 'fatta' || ultimo.stato === 'fallita') return ultimo
      }
    } catch { /* non risponde nemmeno qui: si riprova finche' c'e' tempo */ }
    if (finoA - Date.now() < 3_000) break
    await new Promise(res => setTimeout(res, 2_000))
  }
  return ultimo
}

// I PUNTI DI CONSEGNA di un contratto condiviso: il compratore non ha le credenziali del fornitore
// vero, quindi la ricerca la fa il venditore (GET /api/v1/delivery-points). La risposta torna cosi'
// com'e', stato compreso: un CAP sbagliato resta un 400 per chi l'ha scritto.
export async function puntiMoovexpress(cred: MoovexpressCred, query: URLSearchParams): Promise<{ stato: number; corpo: any }> {
  if (!cred?.api_key) return { stato: 400, corpo: { error: 'Contratto non configurato correttamente' } }
  try {
    const r = await fetch(`${baseUrl(cred)}/api/v1/delivery-points?${query}`, {
      headers: { Authorization: `Bearer ${cred.api_key}` }, signal: AbortSignal.timeout(20000),
    })
    const j: any = await r.json().catch(() => ({}))
    return { stato: r.status, corpo: j }
  } catch {
    return { stato: 502, corpo: { error: 'Ricerca punti non disponibile in questo momento.' } }
  }
}

// Che consegna fa il contratto vero (domicilio o punto), letto dal venditore. Null se non risponde:
// chi lo mostra deve saperlo assente, non indovinarlo.
export async function consegnaMoovexpress(cred: MoovexpressCred): Promise<any | null> {
  if (!cred?.api_key) return null
  try {
    const r = await fetch(`${baseUrl(cred)}/api/v1/account`, {
      headers: { Authorization: `Bearer ${cred.api_key}` }, signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return null
    const j: any = await r.json().catch(() => null)
    return j?.consegna ?? null
  } catch {
    return null
  }
}

// Scarica l'etichetta dal venditore. `labelUrl` è quello tornato dalla create (relativo o assoluto).
//
// Torna anche il TIPO del file, perché non è sempre un PDF: UPS (Europa e Italia) dà un'immagine GIF.
// Chi salvava scriveva sempre `data:application/pdf`: il 20/10 le due UPS Europa di Atlantik srl (prime
// UPS passate da un ponte) sono finite su Storage come sped.pdf con dentro una GIF, e al download il
// cliente riceveva un "PDF" che non si apriva. Il tipo si legge dai BYTE, non dall'intestazione: la riga
// del venditore può essere a sua volta un ponte con lo stesso errore, e l'intestazione lo ripeterebbe.
// Con un tempo massimo: senza, un venditore lento teneva fermo il compratore fino al suo tetto di durata,
// e la riga della spedizione non veniva mai scritta (la LDV restava orfana).
export async function etichettaMoovexpress(cred: MoovexpressCred, labelUrl: string, opz: { timeoutMs?: number } = {}): Promise<{ buffer: Buffer; mime: string }> {
  if (!labelUrl) throw new Error('Nessuna etichetta da scaricare.')
  const url = /^https?:\/\//i.test(labelUrl) ? labelUrl : `${baseUrl(cred)}${labelUrl}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${cred.api_key}` }, signal: AbortSignal.timeout(Math.max(3_000, opz.timeoutMs ?? 20_000)) })
  if (!r.ok) throw new Error(`Etichetta non disponibile dal fornitore (${r.status})`)
  const buffer = Buffer.from(await r.arrayBuffer())
  const dichiarato = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  return { buffer, mime: mimeDaiByte(buffer) || dichiarato || 'application/pdf' }
}

function mimeDaiByte(b: Buffer): string | null {
  if (b.length < 4) return null
  const testa = b.subarray(0, 8).toString('latin1')
  if (testa.startsWith('%PDF')) return 'application/pdf'
  if (testa.startsWith('GIF8')) return 'image/gif'
  if (testa.startsWith('\x89PNG')) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (testa.startsWith('PK\x03\x04')) return 'application/zip'
  return null
}

export type MoovexpressTracking = {
  // Lo stato arriva GIA' nel nostro vocabolario (il venditore l'ha già mappato dal corriere reale
  // quando il suo giro di tracking ha aggiornato la sua spedizione): si usa tale e quale.
  stato: string | null
  consegnata: boolean
  eventi: { data: string; descrizione: string; luogo: string }[]
}

// TRACKING: chiede al venditore lo stato della spedizione (GET /api/v1/tracking/<numero>). Il venditore
// risponde con lo stato della SUA spedizione (già nostro enum) + la cronologia del corriere reale. A più
// salti la catena resta fresca: ogni livello interroga quello sotto (il cron gira su tutte le spedizioni).
// Best-effort: su errore LANCIA (il chiamante, cron o /api/v1, non declassa lo stato se non arriva nulla).
export async function trackingMoovexpress(cred: MoovexpressCred, tracking: string): Promise<MoovexpressTracking> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  if (!tracking) return { stato: null, consegnata: false, eventi: [] }
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/tracking/${encodeURIComponent(tracking)}`, {
      headers: { Authorization: `Bearer ${cred.api_key}` },
      // Senza tempo massimo una risposta che non arriva tiene fermo chi chiede: il 04/11/2026 due di
      // queste sono rimaste appese 300 s e il giro del tracking e' morto con loro.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  const stato = typeof j?.status === 'string' && j.status ? j.status : null
  const eventi = Array.isArray(j?.events) ? j.events.map((e: any) => ({
    data: String(e?.timestamp || ''),
    descrizione: String(e?.status || ''),
    luogo: String(e?.location || ''),
  })) : []
  return { stato, consegnata: stato === 'consegnata', eventi }
}

// Il venditore sta su QUESTO portale: nessun base_url sul contratto e nessun indirizzo fissato per tutti.
// Al 04/11/2026 vale per tutti i 53 contratti condivisi.
export function venditoreSuQuestoPortale(cred: MoovexpressCred): boolean {
  return !cred?.base_url && !process.env.MOOVEXPRESS_API_BASE
}

// TRACKING DAL DATABASE, quando il venditore sta su questo portale: la sua spedizione e' una riga della
// nostra tabella, e chiederla alla nostra stessa /api/v1/tracking via HTTP costava un'altra funzione e una
// dozzina di letture per ogni pacco (il giro ne fa decine di migliaia). Risponde come quella rotta: stessa
// chiave, stesso blocco per chi non paga, stessa spedizione (del cliente della chiave, per LDV o numero),
// stesso stato, cronologia salvata; e se anche il venditore ha comprato il contratto da un altro, si sale
// la catena come fa la rotta, un salto alla volta, fino a chi spedisce davvero (provato il 04/11 su 300
// spedizioni attive contro la rotta vera: senza salire, 27 catene a due salti leggevano l'anello di mezzo
// rimasto indietro). Non chiama il corriere del venditore: la sua spedizione e' anch'essa nel giro e si
// aggiorna da se'. Il freno di frequenza della chiave qui non conta: protegge le API dagli integratori, e
// questa lettura non passa dalle API.
// `memo`: una verifica per chiave e una risoluzione per contratto a giro, non una per pacco.
export type MemoTrackingLocale = {
  accessi: Map<string, Promise<any>>
  chiaveDi: (masterId: string, nomeContratto: string) => Promise<MoovexpressCred | null>
}
export async function trackingMoovexpressLocale(
  admin: any, cred: MoovexpressCred, tracking: string, memo: MemoTrackingLocale, salto = 1,
): Promise<MoovexpressTracking> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  if (!tracking) return { stato: null, consegnata: false, eventi: [] }
  if (!memo.accessi.has(cred.api_key)) {
    const { autenticaApiKey } = await import('@/lib/api-auth')
    memo.accessi.set(cred.api_key, autenticaApiKey(new Request('https://interno/api/v1/tracking', {
      headers: { authorization: `Bearer ${cred.api_key}` },
    })))
  }
  const ctx = await memo.accessi.get(cred.api_key)
  if (!ctx) throw new Error('API key non valida o mancante')
  if (ctx.blocco) throw new Error(`API del venditore ferme per il cliente (${ctx.blocco.motivo})`)
  const trk = String(tracking).trim().replace(/[^A-Za-z0-9._-]/g, '')
  if (!trk) throw new Error('Numero di tracking mancante o non valido')
  const { data: sped } = await admin.from('spedizioni')
    .select('id,stato,numero,tracking_number,master_id,corrieri(tipo,nome_contratto)')
    .eq('cliente_id', ctx.clienteId)
    .or(`tracking_number.eq.${trk},numero.eq.${trk}`)
    .limit(1).maybeSingle()
  if (!sped) throw new Error('Spedizione non trovata')
  const salvati = async () => {
    const { data: ev } = await admin.from('tracking_events')
      .select('stato,descrizione,luogo,data_evento')
      .eq('spedizione_id', sped.id)
      .order('data_evento', { ascending: false })
    return (ev || []).map((e: any) => ({
      data: String(e.data_evento || ''),
      descrizione: String(e.descrizione || e.stato || 'Evento'),
      luogo: String(e.luogo || ''),
    }))
  }
  const statoQui = typeof sped.stato === 'string' && sped.stato ? sped.stato : null
  // Un salto in piu' (il tetto evita di girare per sempre su una catena chiusa ad anello).
  if (sped.corrieri?.tipo === 'moovexpress' && salto < 6) {
    try {
      const credSu = await memo.chiaveDi(sped.master_id, sped.corrieri.nome_contratto)
      if (credSu?.api_key) {
        const trkSu = String(sped.tracking_number || sped.numero || '')
        const su = venditoreSuQuestoPortale(credSu)
          ? await trackingMoovexpressLocale(admin, credSu, trkSu, memo, salto + 1)
          : await trackingMoovexpress(credSu, trkSu)
        const stato = su.stato || statoQui
        return { stato, consegnata: stato === 'consegnata', eventi: su.eventi.length ? su.eventi : await salvati() }
      }
    } catch { /* come la rotta: se il salto sopra non risponde, vale cio' che c'e' qui */ }
  }
  return { stato: statoQui, consegnata: statoQui === 'consegnata', eventi: await salvati() }
}
