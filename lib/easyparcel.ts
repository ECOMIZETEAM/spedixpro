// ═══════════════════════════════════════════════════════════════════════════
// TERZO PROVIDER — corrieri di tipo 'easyparcel' (contratti DVA / DVA Last Minute)
//
// Funziona in modo DIVERSO dagli altri due, e la differenza non e' cosmetica:
//
//   SpediamoPro / Spedisci  →  una chiamata crea la spedizione E restituisce l'etichetta.
//   Questo provider         →  TRE chiamate in fila, ognuna indispensabile:
//        1) quotation  → restituisce un `codice_offerta` (il preventivo, valido per QUELLA rotta)
//        2) order      → acquista QUEL preventivo (scala il credito prepagato del nostro account)
//        3) getwaybill → solo qui nascono il numero di LDV e il PDF dell'etichetta
//
//   L'ordine NON restituisce la lettera di vettura: chi si ferma al passo 2 ha una spedizione
//   pagata e invisibile. Per questo `easyparcelSpedisci` fa i tre passi insieme.
//
// NON ESISTE UNA CHIAMATA DI ANNULLO. Verificato sull'intera documentazione: le chiamate sono
// quotation, order, order-fast, getwaybill, getorder, listorder, tracking, taric-search,
// newcustomer, addfund, balance, pudo, checkcoupon. Nessuna cancellazione. Conseguenza pratica:
// una volta passato il passo 2 il credito e' speso e l'annullo va chiesto fuori dal sistema.
// Chi chiama deve saperlo (vedi `EASYPARCEL_SENZA_ANNULLO`) e NON deve promettere all'utente
// un annullo automatico che qui non puo' esistere.
//
// L'autenticazione e' nel PERCORSO dell'URL, non in un header: /<chiamata>/<APIKEY>.
// Quindi la chiave finisce nella riga di richiesta: mai loggare l'URL per intero.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = 'https://api.easyparcel.it'

// Il provider non ha annullo: costante esportata per non ripetere la spiegazione nei chiamanti.
export const EASYPARCEL_SENZA_ANNULLO =
  'Questo corriere non permette l\'annullo automatico della spedizione: contatta l\'assistenza per la cancellazione.'

export type EsitoEasyparcel = {
  ok: boolean
  codice: number          // errorcode del provider (0 = ok)
  messaggio: string       // messaggio GREZZO del provider — per i log, mai per l'utente
  dati: any               // corpo della risposta
}

// ── Errore tipizzato ───────────────────────────────────────────────────────
// Porta con se' il codice del provider: chi chiama distingue "colpa del dato inserito"
// (110 → si corregge e si riprova) da "colpa nostra" (120 credito esaurito → va ricaricato
// il nostro account, l'utente non c'entra e non deve vedere un errore che lo accusa).
export class ErroreEasyparcel extends Error {
  codice: number
  dettagli: string
  constructor(codice: number, messaggio: string, dettagli = '') {
    super(messaggio)
    this.name = 'ErroreEasyparcel'
    this.codice = codice
    this.dettagli = dettagli
  }
}

// ── Chiamata base ──────────────────────────────────────────────────────────
// Tutte le chiamate sono POST JSON con il campo "call" ripetuto nel corpo.
// Il provider risponde 400 con result:"KO" sugli errori applicativi: non basta guardare res.ok.
async function chiama(apikey: string, call: string, corpo: any, timeoutMs = 30000): Promise<any> {
  if (!apikey) throw new ErroreEasyparcel(101, 'chiave del contratto mancante')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BASE}/${call}/${apikey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, ...corpo }),
      signal: ctrl.signal,
    })
  } catch (e: any) {
    // Timeout / rete: NON e' un errore applicativo. Codice 0 per distinguerlo.
    throw new ErroreEasyparcel(0, e?.name === 'AbortError' ? 'timeout' : String(e?.message || e))
  } finally {
    clearTimeout(t)
  }
  const testo = await res.text()
  let d: any
  try { d = JSON.parse(testo) } catch { d = null }
  if (!d) throw new ErroreEasyparcel(0, `risposta non leggibile (HTTP ${res.status})`, testo.slice(0, 200))

  // Con chiave non valida alcune chiamate (apikeyinfo, quotation) rispondono con l'errore
  // INCAPSULATO IN UN ARRAY — [{"result":"KO","errorcode":"101",...}] — mentre altre (order)
  // rispondono con l'oggetto nudo. Senza questo scarto, `d.result` su un array e' undefined:
  // un contratto con la chiave sbagliata non darebbe errore, tornerebbe semplicemente "nessuna
  // tariffa disponibile" e il problema resterebbe invisibile.
  if (Array.isArray(d) && d.length === 1 && d[0] && typeof d[0] === 'object') d = d[0]

  // errorcode arriva a volte stringa ("0") a volte numero (0): normalizzo.
  const codice = Number(d.errorcode ?? d.error_code ?? 0) || 0
  const msg = String(d.errormessage ?? d.error_message ?? '')
  if (String(d.result || '').toUpperCase() === 'KO' || (codice !== 0 && !res.ok)) {
    // Il provider RIMANDA INDIETRO LA CHIAVE dentro il messaggio ("APIKEY - Non valida: <chiave>").
    // Quel messaggio finisce nei log applicativi: la chiave va tolta prima di costruire l'errore.
    const senzaChiave = (t: string) => t.split(apikey).join('***')
    throw new ErroreEasyparcel(codice, senzaChiave(msg) || `HTTP ${res.status}`, senzaChiave(String(d.errordetails || '')))
  }
  return d
}

// ── Stato dell'account (chiave valida? credito? ambiente reale o di prova?) ──
export async function easyparcelInfo(apikey: string): Promise<{
  cliente: string; live: boolean; credito: number; scadenza: string; canale: string; idDva: string
}> {
  const d = await chiama(apikey, 'apikeyinfo', {})
  // Questa chiamata annida tutto sotto response.dettagli, a differenza di tutte le altre.
  const info = d?.response?.dettagli || d?.apikeyinfo || d
  return {
    cliente: String(info.cliente || ''),
    // ATTENZIONE: arriva la STRINGA "false"/"true". Un Boolean() secco direbbe sempre true
    // e mostrerebbe come reali degli ordini di prova.
    live: String(info.live).toLowerCase() === 'true',
    credito: parseFloat(info.credito_prepagato || '0') || 0,
    scadenza: String(info.scadenza || ''),
    canale: String(info.canale || ''),
    idDva: String(info.id_dva || ''),
  }
}

// ── 1) PREVENTIVO ──────────────────────────────────────────────────────────
// Serve SEMPRE, anche quando il prezzo di vendita lo decide il nostro listino: e' l'unico
// modo di ottenere il `codice_offerta` senza il quale l'ordine non si puo' fare.
export type ColloEasyparcel = { peso: number; larghezza: number; profondita: number; altezza: number }
export type LuogoEasyparcel = { cap: string; localita: string; provincia: string; nazione?: string }

export async function easyparcelQuotation(apikey: string, dati: {
  colli: ColloEasyparcel[]
  mittente: LuogoEasyparcel
  destinatario: LuogoEasyparcel
  contenuto?: string
  contrassegno?: number
  assicurazione?: number
}): Promise<any[]> {
  const estero = (dati.destinatario.nazione || 'IT').toUpperCase() !== 'IT'
  const accessori: any = {}
  if (dati.contrassegno && dati.contrassegno > 0) accessori.contrassegno_importo = Number(dati.contrassegno.toFixed(2))
  if (dati.assicurazione && dati.assicurazione > 0) accessori.assicurazione_importo = Number(dati.assicurazione.toFixed(2))

  const d = await chiama(apikey, 'quotation', {
    dettagli: {
      tipo_spedizione: estero ? 'E' : 'N',
      cosa_spedire: 'M',
      // Campo obbligatorio per il provider. Da noi la descrizione merce e' facoltativa:
      // senza un ripiego la quotazione fallirebbe su ogni spedizione lasciata in bianco.
      contenuto: (dati.contenuto || '').trim().slice(0, 50) || 'MERCE VARIA',
      ...(Object.keys(accessori).length ? { accessori } : {}),
    },
    colli: serieColli(dati.colli),
    mittente: luogo(dati.mittente, false),
    destinatario: luogo(dati.destinatario, estero),
  })
  return Array.isArray(d.quotation) ? d.quotation : []
}

// I colli non si spediscono uno per elemento: il provider ragiona per SERIE di colli uguali.
// Nella sua struttura `peso` e' il peso COMPLESSIVO della serie, le misure sono quelle del SINGOLO
// collo, e `nr_colli` dice quanti sono. Mandare N elementi con nr_colli:1 e' una forzatura della
// struttura, ed e' il sospetto numero uno dietro l'etichetta unica sui multicollo.
// Qui i colli vengono quindi RAGGRUPPATI PER SAGOMA: una serie per ogni terna di misure distinta.
// Non e' un caso di scuola — sui nostri dati reali il 57% delle spedizioni multicollo ha colli di
// misure diverse fra loro, quindi la forma "una serie sola" non basterebbe mai da sola.
export function serieColli(colli: ColloEasyparcel[]): Array<{ peso: number; larghezza: number; profondita: number; altezza: number; nr_colli: number }> {
  const gruppi = new Map<string, { larghezza: number; profondita: number; altezza: number; peso: number; nr_colli: number }>()
  for (const c of (colli || [])) {
    const larghezza = Math.max(1, Math.round(c?.larghezza || 10))
    const profondita = Math.max(1, Math.round(c?.profondita || 10))
    const altezza = Math.max(1, Math.round(c?.altezza || 10))
    const peso = Number(c?.peso) || 1
    // Nella chiave c'e' anche il PESO, non solo le misure. Verificato sul campo: una serie con
    // nr_colli:3 e peso 6 viene esplosa dal provider in tre colli da 2 kg — cioe' divide il peso
    // della serie per il numero di colli. Raggruppando due colli di peso diverso ma stessa sagoma
    // (2 kg + 4 kg) il provider registrerebbe due colli da 3 kg: totale giusto, singoli sbagliati.
    const chiave = `${peso}|${larghezza}x${profondita}x${altezza}`
    const g = gruppi.get(chiave)
    if (g) { g.peso += peso; g.nr_colli += 1 }
    else gruppi.set(chiave, { larghezza, profondita, altezza, peso, nr_colli: 1 })
  }
  // Senza colli non si quota nulla: un collo minimo di ripiego evita una richiesta vuota.
  if (!gruppi.size) return [{ peso: 1, larghezza: 10, profondita: 10, altezza: 10, nr_colli: 1 }]
  return Array.from(gruppi.values()).map(g => ({
    peso: Number(g.peso.toFixed(3)),
    larghezza: g.larghezza, profondita: g.profondita, altezza: g.altezza,
    nr_colli: g.nr_colli,
  }))
}

function luogo(l: LuogoEasyparcel, estero: boolean) {
  return {
    cap: String(l.cap || '').trim(),
    localita: String(l.localita || '').trim().toUpperCase().slice(0, 35),
    // Su estero il provider vuole '--' al posto della sigla provincia italiana.
    provincia: estero ? '--' : String(l.provincia || '').trim().toUpperCase().slice(0, 2),
    nazione: (l.nazione || 'IT').toUpperCase(),
  }
}

// ── Scelta dell'offerta giusta ─────────────────────────────────────────────
// Il preventivo torna PIU' offerte (tutti i vettori agganciati alla chiave). Ogni nostro contratto
// e' legato a un vettore preciso (credenziali.vettore).
//
// MA IL CODICE VETTORE NON BASTA: identifica il CORRIERE, non il SERVIZIO. Verificato sul campo che
// TNT compare TRE VOLTE nella stessa risposta, stesso codice "TNTM", con `consegna` diversa e prezzi
// lontanissimi: E (espresso, 6,74) / X12 (entro le 12, 18,72) / X10 (entro le 10, 20,65). Prendere
// "la prima che combacia" significa comprare un servizio a caso — e su Milano la differenza fra il
// primo e il terzo e' tripla.
// Quindi: se il contratto dichiara anche `consegna`, deve combaciare pure quella. Se non lo dichiara
// e le offerte per quel vettore sono piu' d'una, si restituisce NULL: meglio una spedizione che non
// parte con un errore chiaro, che una spedizione comprata sul servizio sbagliato.
export function trovaOffertaVettore(offerte: any[], vettore: string, consegna?: string): any | null {
  if (!Array.isArray(offerte) || !offerte.length) return null
  const cercato = String(vettore || '').trim().toUpperCase()
  if (!cercato) return null
  const stessoVettore = offerte.filter((o: any) => String(o?.vettore || '').trim().toUpperCase() === cercato)
  if (!stessoVettore.length) return null
  const servizio = String(consegna || '').trim().toUpperCase()
  if (servizio) {
    const esatta = stessoVettore.filter((o: any) => String(o?.consegna || '').trim().toUpperCase() === servizio)
    return esatta.length === 1 ? esatta[0] : null
  }
  // Nessun servizio dichiarato: va bene solo se non c'e' ambiguita'.
  return stessoVettore.length === 1 ? stessoVettore[0] : null
}

// ── 2) ORDINE ──────────────────────────────────────────────────────────────
// Da qui in poi il credito prepagato E' SPESO e non esiste modo di annullare via API.
export type PersonaEasyparcel = {
  nominativo: string; indirizzo: string; email: string
  cellulare: string; telefono?: string; contatto?: string; codicefiscale?: string
}

export async function easyparcelOrder(apikey: string, dati: {
  codiceOfferta: string
  mittente: PersonaEasyparcel
  destinatario: PersonaEasyparcel
  note?: string
  custom?: string
  contrassegno?: boolean
  contrassegnoModalita?: 'C' | 'A'
  assicurazione?: boolean
  ritiro?: { dal: string; dalleMattina?: string; alleMattina?: string; dallePomeriggio?: string; allePomeriggio?: string }
}): Promise<{ ordine: string; idOrdine: string; importo: number; codiceOfferta: string }> {
  const accessori: any = {}
  if (dati.contrassegno) { accessori.contrassegno = 'S'; accessori.contrassegno_modalita = dati.contrassegnoModalita || 'C' }
  if (dati.assicurazione) accessori.assicurazione = 'S'

  const corpo: any = {
    dettagli: {
      codice_offerta: dati.codiceOfferta,
      ...(dati.note ? { note_cliente: String(dati.note).slice(0, 200) } : {}),
      ...(dati.custom ? { custom: String(dati.custom).slice(0, 50) } : {}),
      ...(Object.keys(accessori).length ? { accessori } : {}),
    },
    mittente: persona(dati.mittente),
    destinatario: persona(dati.destinatario),
  }
  if (dati.ritiro?.dal) {
    corpo.ritiro = {
      prenotazione: 'S',
      dettagli: {
        ritirodove: 'M',
        disponibile_dal: dati.ritiro.dal,
        disponibile_ora: dati.ritiro.dalleMattina || '09:00',
        ritiro_mattina_dalle: dati.ritiro.dalleMattina || '09:00',
        ritiro_mattina_alle: dati.ritiro.alleMattina || '13:00',
        ritiro_pomeriggio_dalle: dati.ritiro.dallePomeriggio || '14:00',
        ritiro_pomeriggio_alle: dati.ritiro.allePomeriggio || '18:00',
      },
    }
  }

  const d = await chiama(apikey, 'order', corpo)
  const idOrdine = String(d.id_ordine || '')
  // Senza id_ordine il passo 3 e' impossibile: l'ordine sarebbe pagato e irrecuperabile.
  // Meglio saperlo subito con un errore esplicito che scoprirlo a etichetta mancante.
  if (!idOrdine) throw new ErroreEasyparcel(131, 'ordine accettato ma senza identificativo', JSON.stringify(d).slice(0, 200))
  return {
    ordine: String(d.ordine || ''),
    idOrdine,
    importo: parseFloat(d.importo || '0') || 0,
    codiceOfferta: String(d.codice_offerta || dati.codiceOfferta),
  }
}

function persona(p: PersonaEasyparcel) {
  const cell = String(p.cellulare || '').replace(/[^0-9]/g, '')
  const tel = String(p.telefono || '').replace(/[^0-9]/g, '')
  const o: any = {
    nominativo: String(p.nominativo || '').trim().slice(0, 50),
    indirizzo: String(p.indirizzo || '').trim().slice(0, 100),
    email: String(p.email || '').trim().slice(0, 60),
    cellulare: cell,
    contatto: String(p.contatto || p.nominativo || '').trim().slice(0, 50),
  }
  if (tel) o.telefono = tel
  if (p.codicefiscale) o.codicefiscale = String(p.codicefiscale).trim().toUpperCase().slice(0, 16)
  return o
}

// ── 3) LETTERA DI VETTURA ──────────────────────────────────────────────────
// Il numero di tracking e il PDF nascono QUI, non nell'ordine. Subito dopo l'acquisto possono
// non essere ancora pronti: si riprova qualche volta prima di arrendersi. L'assenza della LDV
// non annulla l'ordine (che resta pagato): il chiamante deve salvare comunque la spedizione e
// recuperare l'etichetta piu' tardi.
export async function easyparcelWaybill(
  apikey: string, idOrdine: string, tentativi = 3, attesaMs = 1500
): Promise<{ numero: string; pdfBase64: string | null; singole: { numero: string; pdfBase64: string }[]; borderoUrl: string | null; codiceRitiro: string | null }> {
  let ultimo: any = null
  for (let i = 0; i < Math.max(1, tentativi); i++) {
    if (i > 0) await new Promise(r => setTimeout(r, attesaMs))
    try {
      const d = await chiama(apikey, 'getwaybill', {
        details: { order_id: Number(idOrdine) || idOrdine, waybill_base64: 'Y', single_waybills: 'Y' },
      })
      ultimo = d
      const numero = String(d.waybill_number || '')
      if (!numero) continue          // ancora in lavorazione: si riprova
      const singole = (Array.isArray(d.single_waybills) ? d.single_waybills : [])
        .map((s: any) => ({ numero: String(s?.waybill_number || ''), pdfBase64: String(s?.waybill_base64 || '') }))
        .filter((s: any) => s.pdfBase64)
      // pickup_code non e' sempre un codice: quando il ritiro non e' stato chiesto arriva la frase
      // "Service not required". Salvarla come se fosse un codice significherebbe mostrare all'utente
      // un finto numero di prenotazione ritiro.
      const cr = String(d.pickup_code || '').trim()
      return {
        numero,
        pdfBase64: d.waybill_base64 ? String(d.waybill_base64) : null,
        singole,
        borderoUrl: d.bordero_url ? String(d.bordero_url) : null,
        codiceRitiro: cr && !/not required|non richiest/i.test(cr) ? cr : null,
      }
    } catch (e: any) {
      ultimo = e
      // 110/0 subito dopo l'ordine = non ancora pronta: si insiste. Gli altri codici sono
      // definitivi (chiave, credito, ordine inesistente) e insistere non cambia nulla.
      if (e instanceof ErroreEasyparcel && ![0, 110].includes(e.codice)) throw e
    }
  }
  throw new ErroreEasyparcel(
    ultimo instanceof ErroreEasyparcel ? ultimo.codice : 110,
    'lettera di vettura non ancora disponibile',
    ultimo instanceof ErroreEasyparcel ? ultimo.dettagli : ''
  )
}

// Unisce le etichette dei singoli colli in un PDF unico multipagina, una pagina per collo.
// Serve al tasto "Etichetta" della spedizione: con un multicollo l'operatore deve poter stampare
// tutto in un colpo, non scaricare un file per collo. Stessa resa che l'altro provider ottiene
// unendo lo ZIP. Se l'unione non riesce si ripiega sulla prima: meglio una che nessuna.
export async function unisciEtichette(pdfBase64: string[]): Promise<string | null> {
  const validi = (pdfBase64 || []).filter(Boolean)
  if (!validi.length) return null
  if (validi.length === 1) return validi[0]
  try {
    const { PDFDocument } = await import('pdf-lib')
    const unito = await PDFDocument.create()
    for (const b64 of validi) {
      const src = await PDFDocument.load(Buffer.from(b64, 'base64'))
      const pagine = await unito.copyPages(src, src.getPageIndices())
      for (const p of pagine) unito.addPage(p)
    }
    return Buffer.from(await unito.save()).toString('base64')
  } catch {
    return validi[0]
  }
}

// ── TRACKING ───────────────────────────────────────────────────────────────
// Restituisce le stringhe di stato candidate (come per l'altro provider) piu' il grezzo.
// PRECEDENZA AL CODICE OFFERTA, non alla LDV: verificato sul campo che la ricerca per `ldv`
// risponde "Spedizione non trovata" mentre quella per codice_offerta funziona. Il codice offerta
// e' anche l'unico riferimento che possediamo con certezza dal momento dell'ordine, mentre la LDV
// arriva solo dopo la waybill. La ricerca per LDV resta come ultimo tentativo.
export async function easyparcelTracking(
  apikey: string, chiave: { ldv?: string; codiceOfferta?: string; custom?: string }
): Promise<{ stati: string[]; raw: any }> {
  const dettagli: any = {}
  if (chiave.codiceOfferta) dettagli.codice_offerta = chiave.codiceOfferta
  else if (chiave.custom) dettagli.custom = chiave.custom
  else if (chiave.ldv) dettagli.ldv = chiave.ldv
  else throw new ErroreEasyparcel(110, 'nessun riferimento per il tracking')

  const d = await chiama(apikey, 'tracking', { dettagli })
  const eventi: any[] = Array.isArray(d.dettagli) ? d.dettagli : []
  const stati: string[] = []
  for (const ev of eventi) {
    for (const k of ['descrizione', 'note']) {
      if (typeof ev?.[k] === 'string' && ev[k].trim()) stati.push(ev[k])
    }
  }
  return { stati, raw: d }
}

// ── Mappatura stato provider → stato interno ───────────────────────────────
// Il provider manda `status` a 3 lettere (RIT, PPP, THE, …) + descrizione in italiano.
// Il codice secco NON basta: cambia per vettore. Si legge la descrizione, con i codici come
// rinforzo sui casi certi.
export function mapStatoEasyparcel(testo: string): string | null {
  const s = (testo || '').toLowerCase()
  if (!s) return null
  if (/consegnat|delivered/.test(s)) return 'consegnata'
  if (/giacenz|deposit|fermo deposito/.test(s)) return 'in_giacenza'
  // "in consegna" prima di "transito": molti eventi contengono entrambe le parole.
  if (/in consegna|out for delivery|in distribuzione|consegna prevista/.test(s)) return 'in_consegna'
  if (/reso|rientro|al mittente|restituit/.test(s)) return 'reso_mittente'
  if (/mancata|fallit|rifiut|anomal|indirizzo errato|destinatario assente|non consegnat/.test(s)) return 'non_consegnato'
  if (/transito|smistat|hub|partita|in viaggio|arrivat|inoltrat/.test(s)) return 'in_transito'
  if (/ritirat|presa in carico|accettat|spedit|affidat/.test(s)) return 'spedita'
  return null
}

// ── Errori mostrabili all'utente ───────────────────────────────────────────
// Regola invariata su tutto il sistema: l'utente vede il BRAND del corriere, mai il provider
// tecnico a valle. Qui si traduce anche il dettaglio "Campo 'mittente->cap' mancante o non
// corretto", che indica esattamente il dato da correggere: buttarlo via sarebbe un peccato,
// ma va riscritto in italiano comprensibile.
const CAMPI: Array<[RegExp, string]> = [
  [/mittente->cap|mittente.*cap/i, 'CAP del mittente mancante o non valido'],
  [/destinatario->cap|destinatario.*cap/i, 'CAP del destinatario mancante o non valido'],
  [/mittente->cellulare|mittente.*cellulare/i, 'cellulare del mittente mancante o non valido'],
  [/destinatario->cellulare|destinatario.*cellulare/i, 'cellulare del destinatario mancante o non valido'],
  [/mittente->email|mittente.*email/i, 'email del mittente mancante o non valida'],
  [/destinatario->email|destinatario.*email/i, 'email del destinatario mancante o non valida'],
  [/codicefiscale/i, 'codice fiscale mancante o non valido'],
  [/mittente->localita|mittente.*localita/i, 'città del mittente mancante'],
  [/destinatario->localita|destinatario.*localita/i, 'città del destinatario mancante'],
  [/provincia/i, 'provincia mancante o non valida (usa la sigla, es. RM)'],
  [/indirizzo/i, 'indirizzo mancante o non valido'],
  [/nominativo/i, 'nome/ragione sociale mancante'],
  [/contenuto/i, 'descrizione del contenuto mancante'],
  [/peso/i, 'peso del collo mancante o non valido'],
]

export function erroreEasyparcelPulito(e: any): string {
  const codice = e instanceof ErroreEasyparcel ? e.codice : -1
  // Il nome del campo mancante puo' arrivare in errordetails OPPURE dentro errormessage
  // ("JSON - Errore: Campo 'mittente->cellulare' mancante"): verificato sul campo che sul
  // campo mancante arriva nel SECONDO, con errordetails vuoto. Si guardano entrambi.
  const dettagli = e instanceof ErroreEasyparcel ? `${e.dettagli} ${e.message}` : ''

  switch (codice) {
    case 101:
    case 102:
    case 103:
      // Problema di configurazione NOSTRO: l'utente non puo' farci nulla e non deve essere accusato.
      return 'Questo corriere non è al momento disponibile: contatta l\'assistenza.'
    case 104:
      return 'Questo corriere ha raggiunto il limite di spedizioni giornaliere: riprova domani o scegli un altro corriere.'
    case 120:
      // Credito del NOSTRO account presso il corriere, non quello del cliente: guai a scrivere
      // "credito insufficiente" secco, il cliente crederebbe di essere lui a secco.
      return 'Questo corriere non è al momento disponibile: contatta l\'assistenza.'
    case 130:
      return 'Questa spedizione risulta già acquistata: ricarica l\'elenco prima di riprovare.'
    case 131:
    case 132:
      return 'Il corriere non ha potuto registrare la spedizione in questo momento: riprova tra qualche minuto o scegli un altro corriere.'
    case 110: {
      for (const [re, testo] of CAMPI) if (re.test(dettagli)) return `Dati non accettati dal corriere: ${testo}. Correggi e riprova.`
      return 'Dati non accettati dal corriere: verifica indirizzo, CAP, città, provincia, telefono ed email e riprova.'
    }
    case 0:
      return 'Il corriere non ha risposto in tempo. Riprova tra qualche istante.'
  }
  return 'Corriere non disponibile per questa spedizione. Riprova o scegli un altro corriere.'
}

// Rete di sicurezza: nessun testo che esca da qui deve contenere il nome del provider tecnico
// o i suoi indirizzi. Da usare su qualunque stringa grezza si voglia mostrare o salvare.
export function ripuliscEasyparcel(testo: string): string {
  return String(testo || '')
    .replace(/easy\s*parcel/gi, 'corriere')
    .replace(/api\.easyparcel\.it|www\.easyparcel\.it|easyparcel\.it/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
