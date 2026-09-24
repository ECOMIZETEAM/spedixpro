import { createHash } from 'crypto'
import { testoIndicaReso, prioritaStato } from '@/lib/spedisci'

/* Provider DIELLE / TWS Software (documentazione.twssoftware.it/documentation/dielle/api).
 *
 * NON è un corriere singolo: è un AGGREGATORE (come Spedisci.online/SpediamoPro) con DENTRO più corrieri
 * (BRT, GLS, UPS…). Quindi si modella come gli altri provider: un ACCOUNT (username+password) = una
 * `corrieri.credenziali`, e OGNI corriere reale è una riga `corrieri` con dentro i suoi CODICI SERVIZIO
 * (servizio/codiceServizio/accessorio_crono), come `carrier_code` per Spedisci. Il nome "Dielle/TWS" NON
 * si mostra mai (regola #8): a video escono i brand (BRT/GLS/UPS).
 *
 * Auth: nel BODY (non header) `{ username, password: <hash>, data }`. La password si hasha con lo schema
 * loro. Due host per ambiente: la ROOT (staging TWS / prod Dielle) e sotto il modulo `/ws`.
 *
 * COLLEGATO E VALIDATO SU STAGING (24/9): creazione (crea/route.ts + /api/v1/shipments), etichetta e
 * TRACKING (cron aggiorna). Auth v1, decimali con la virgola, etichetta base64→PDF, tracking sotto la
 * ROOT (non /ws). Resta da validare sulla PROD (host diverso) al primo contratto reale. Nessun ANNULLO
 * via API: Dielle non ce l'ha, si fa solo dal portale.
 */

// Due host: la ROOT del server e, sotto, il modulo /ws. I servizi di CREAZIONE/etichetta/conferma
// stanno sotto `/ws` (es. .../ws/insSped); il TRACKING sta sotto la ROOT (.../extracking/trackingStatus,
// SENZA /ws — verificato 24/9: /ws/extracking/trackingStatus dà 404, /extracking/trackingStatus dà 200).
const ROOT = {
  prod: 'https://mydiellebe.it',
  // ATTENZIONE: lo staging è in CHIARO (HTTP), non HTTPS — la doc dice "https" ma il server su :8085
  // non parla TLS (verificato 24/9: TLS handshake fallisce, HTTP risponde). La prod è su un altro host.
  staging: 'http://www.tsm-staging.twssoftware.it:8085',
}

export type DielleCred = {
  username: string
  password: string              // in chiaro in credenziali (protetta), si hasha al momento della chiamata
  ambiente?: 'prod' | 'staging' // default 'prod'
}

function root(c: DielleCred): string { return ROOT[c.ambiente === 'staging' ? 'staging' : 'prod'] }
function base(c: DielleCred): string { return root(c) + '/ws' }

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// Schema Dielle: SHA-256(password), SHA-256(username), si concatenano, poi SHA-256 della concatenazione
// 5 volte. VALIDATO su staging il 24/9: stringhe HEX, ordine password+username (le altre combinazioni
// danno "Credenziali non presenti"). Questa è quella giusta.
export function hashPasswordDielle(username: string, password: string): string {
  let x = sha256(password) + sha256(username)
  for (let i = 0; i < 5; i++) x = sha256(x)
  return x
}

// `path` sotto /ws (default) oppure sotto la ROOT del server (extracking) se `radice` è true.
async function chiama(c: DielleCred, path: string, data: unknown, radice = false): Promise<{ ok: boolean; status: number; j: any }> {
  let r: Response
  try {
    r = await fetch(`${radice ? root(c) : base(c)}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: c.username, password: hashPasswordDielle(c.username, c.password), data }),
    })
  } catch (e: any) {
    throw new Error('Dielle non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

// Nazione: la doc vuole ISO 3166-1 alpha-3 (ITA, non IT). Mappa i casi comuni; se già 3 lettere, passa.
const ISO3: Record<string, string> = { IT: 'ITA', FR: 'FRA', DE: 'DEU', ES: 'ESP', GB: 'GBR', US: 'USA', CH: 'CHE', AT: 'AUT', BE: 'BEL', NL: 'NLD', PT: 'PRT', SM: 'SMR', VA: 'VAT' }
function nazione(v: string | undefined): string {
  const s = String(v || 'IT').toUpperCase().trim()
  return s.length === 3 ? s : (ISO3[s] || 'ITA')
}

export type DielleRecapito = {
  ragione_sociale: string
  indirizzo: string
  civico?: string
  comune: string
  cap: string
  provincia?: string
  nazione?: string
  referente?: string
  email?: string
  telefono?: string
}
export type DielleCollo = { altezza?: number | string; larghezza?: number | string; profondita?: number | string; peso: number | string }

export type DielleSpedInput = {
  // Dal CONTRATTO (settings del corriere): quale servizio/corriere reale è.
  servizio: string
  codiceServizio?: string
  accessorioCrono?: string
  tipoSpedizione?: string       // default 'Standard'
  dataSpedizione?: string       // YYYYMMDD, default oggi
  numeroOrdine?: string
  mittente: DielleRecapito
  destinatario: DielleRecapito
  colli: DielleCollo[]
  contrassegno?: number
  tipoPagamento?: string
  assicurata?: number
  note?: string
}

const oggiYmd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` }
// Dielle vuole il decimale con la VIRGOLA (esempio reale della doc: pesocolli "10,00"), non col punto.
const due = (n: unknown) => (Number(n) || 0).toFixed(2).replace('.', ',')
const recapito = (r: DielleRecapito) => ({
  ragione_sociale: r.ragione_sociale, indirizzo: r.indirizzo, civico: r.civico || '',
  comune: r.comune, cap: String(r.cap || ''), provincia: (r.provincia || '').toUpperCase(),
  nazione: nazione(r.nazione), referente: r.referente || '', email: r.email || '', telefono: r.telefono || '',
})

// Crea la spedizione (/insSped → torna `ldv`). Lancia Error con errorMessage se il provider dà errore.
export async function creaSpedizioneDielle(c: DielleCred, dati: DielleSpedInput): Promise<{ ldv: string; raw: any }> {
  const pesoTot = dati.colli.reduce((s, p) => s + (Number(p.peso) || 0), 0)
  // OPZIONI solo se valorizzate: Dielle rifiuta i campi vuoti (verificato — un `importoContrassegno`/
  // `tipoPagamento` vuoto dà errorCode 119 "metodo di pagamento e importo devono essere entrambi
  // valorizzati per spedizioni in contrassegno", anche senza contrassegno). E se c'è il contrassegno,
  // vogliono ENTRAMBI i campi (importo + metodo): default 'WITH' (contanti) se il metodo non è dato.
  const opzioni: Record<string, string> = {}
  if (dati.contrassegno) { opzioni.importoContrassegno = due(dati.contrassegno); opzioni.tipoPagamento = dati.tipoPagamento || 'WITH' }
  if (dati.assicurata) opzioni.importoAssicurata = due(dati.assicurata)
  if (dati.codiceServizio) opzioni.codiceServizio = dati.codiceServizio
  if (dati.accessorioCrono) opzioni.accessorio_crono = dati.accessorioCrono

  const data: any = {
    tipoSpedizione: dati.tipoSpedizione || 'Standard',
    servizio: dati.servizio,
    dataSpedizione: dati.dataSpedizione || oggiYmd(),
    mittente: recapito(dati.mittente),
    destinatario: recapito(dati.destinatario),
    numerocolli: String(dati.colli.length),
    pesocolli: due(pesoTot),
    colli: dati.colli.map(p => ({ altezza: String(p.altezza ?? ''), larghezza: String(p.larghezza ?? ''), profondita: String(p.profondita ?? ''), peso: due(p.peso) })),
  }
  if (dati.numeroOrdine) data.numeroOrdine = dati.numeroOrdine
  if (Object.keys(opzioni).length) data.opzioni = opzioni
  if (dati.note) data.note = dati.note
  const { ok, status, j } = await chiama(c, 'insSped', data)
  if (!ok) throw new Error(j?.errorMessage || j?.error || `Dielle: errore ${status}`)
  if (j?.errorCode || !j?.ldv) throw new Error(j?.errorMessage || 'Dielle: creazione non riuscita')
  return { ldv: String(j.ldv), raw: j }
}

// Etichetta. formato: 'pdf' (getSpedLdvZebra, PDF Zebra) | 'a4' (getSpedA4) | 'zpl' (getSpedZplZebra).
// La spedizione si identifica passando l'`ldv` come `data` (stringa). VALIDATO su staging il 24/9: il
// campo `ldv` torna come STRINGA base64 che decodifica in un PDF (%PDF-). Gestiamo comunque anche l'array.
export async function etichettaDielle(c: DielleCred, ldv: string, formato: 'pdf' | 'a4' | 'zpl' = 'pdf'): Promise<{ contentType: string; bytes?: Buffer; zpl?: string }> {
  const path = formato === 'zpl' ? 'getSpedZplZebra' : formato === 'a4' ? 'getSpedA4' : 'getSpedLdvZebra'
  const { ok, status, j } = await chiama(c, path, ldv)
  if (!ok || j?.errorCode) throw new Error(j?.errorMessage || `Dielle: etichetta non disponibile (${status})`)
  if (formato === 'zpl') return { contentType: 'text/plain', zpl: String(j?.ldv || '') }
  const raw = j?.ldv
  const bytes = Array.isArray(raw) ? Buffer.from(raw) : Buffer.from(String(raw || ''), 'base64')
  return { contentType: 'application/pdf', bytes }
}

// Mappa la DESCRIZIONE dello stato Dielle sui nostri stati. Si mappa sul TESTO (`stato`), non sul
// `codiceStato`: i codici sono 816, duplicati fra i corrieri dentro l'aggregatore (BRT/GLS/UPS…) e non
// verificabili live, mentre la descrizione è in chiaro e autoesplicativa. Stesso impianto di
// mapStatoSpedisci: RESO PER PRIMO (il ritorno al mittente si chiude con una "consegnata" che NON è la
// consegna al destinatario), poi consegna, giacenza, e i movimenti. "NUOVA"/registrata → nessun
// avanzamento (la spedizione esiste ma non si è ancora mossa): torna null, resta solo l'evento.
export function mapStatoDielle(testo: string): string | null {
  const s = (testo || '').toLowerCase().trim()
  if (!s) return null
  if (testoIndicaReso(s)) return 'reso_mittente'
  if ((s.includes('consegnat') || s.includes('delivered')) && !s.includes('non consegnat')) {
    // Deposito/punto di ritiro: il destinatario deve ancora ritirare, non è consegna a domicilio.
    if (/ufficio postale|punto di giacenza|fermo deposito|fermoposta|punto di ritiro|locker|punto di consegna|fermopoint/.test(s)) return 'in_consegna'
    return 'consegnata'
  }
  if (s.includes('giacenz')) return 'in_giacenza'
  // Consegna fallita PRIMA di "in consegna": un tentativo andato male non è un giro in corso.
  if (/non andata a buon fine|consegna non riuscita|non consegnat|mancata consegna|tentata consegna|tentativo di consegna|destinatario assente|\bassente\b/.test(s)) return 'non_consegnato'
  if (s.includes('in consegna') || s.includes('in distribuzione') || s.includes('distribuzione') || s.includes('out for delivery')) return 'in_consegna'
  if (/svincol/.test(s)) return 'in_transito'   // svincolata: dopo la giacenza torna a viaggiare
  if (s.includes('transit') || s.includes('transito') || s.includes('arrivat') || s.includes('hub') || s.includes('partenz') || s.includes('partit') || s.includes('viaggio') || s.includes('smistament') || s.includes('in filiale') || s.includes('presso filiale')) return 'in_transito'
  if (s.includes('presa in carico') || s.includes('preso in caric') || s.includes('spedit') || s.includes('accettat') || s.includes('ritirat') || s.includes('picked') || s.includes('lavorazione') || s.includes('prelevat')) return 'spedita'
  if (s.includes('rifiut') || s.includes('respint') || s.includes('exception') || s.includes('anomal') || s.includes('problema') || s.includes('indirizzo errato') || s.includes('indirizzo insufficiente') || s.includes('fallit') || s.includes('mancata')) return 'non_consegnato'
  return null
}

// Tracking (/extracking/trackingStatus — NB: sotto la ROOT, non /ws). Verificato su staging il 24/9:
// risposta `ActionStatusDao` = { stato:"OK", errors, response: List<TrackingDao> }. Il PRIMO TrackingDao
// è la LDV madre (gli altri sono i singoli colli, spesso con ldv="collo" e stati vuoti). Ogni evento
// (`stati_tracking[]`) ha { stato (testo), codiceStato, data (DD-MM-YYYY), ora (HH:mm:ss), firma, filiale }.
// DATA E ORA SEPARATE, GIORNO-MESE-ANNO: le RICOMBINO in "DD-MM-YYYY HH:mm:ss" e la passo come `data` a
// normalizzaEventi, che riconosce la forma italiana e NON la dà mai a new Date() (che la leggerebbe
// all'americana — la stessa trappola di DVA). Torno la forma che si aspetta la cron (come trackingBrt).
export async function trackingDielle(
  c: DielleCred, ldv: string,
): Promise<{ stati: string[]; consegnata: boolean; eventi: { data: string; descrizione: string; luogo: string }[] }> {
  const { ok, status, j } = await chiama(c, 'extracking/trackingStatus', ldv, true)
  if (!ok) throw new Error(j?.errorMessage || `Dielle: tracking errore ${status}`)
  const lista: any[] = Array.isArray(j?.response) ? j.response : []
  // La LDV madre: quella col numero uguale a quello cercato (o, in mancanza, la prima con eventi).
  const madre = lista.find(t => String(t?.ldv || '') === String(ldv)) || lista.find(t => Array.isArray(t?.stati_tracking) && t.stati_tracking.length) || lista[0]
  const righe: any[] = Array.isArray(madre?.stati_tracking) ? madre.stati_tracking : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  for (const ev of righe) {
    const testo = String(ev?.stato || '').trim()
    if (testo) stati.push(testo)
    const d = String(ev?.data || '').trim()
    const ora = String(ev?.ora || '').trim()
    const descr = testo || String(ev?.note || '').trim()
    if (d && descr) eventi.push({ data: ora ? `${d} ${ora}` : d, descrizione: descr, luogo: String(ev?.filiale || '').trim() })
  }
  const consegnata = stati.some(str => mapStatoDielle(str) === 'consegnata')
  return { stati, consegnata, eventi }
}
