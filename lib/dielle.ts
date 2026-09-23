import { createHash } from 'crypto'

/* Provider DIELLE / TWS Software (documentazione.twssoftware.it/documentation/dielle/api).
 *
 * NON è un corriere singolo: è un AGGREGATORE (come Spedisci.online/SpediamoPro) con DENTRO più corrieri
 * (BRT, GLS, UPS…). Quindi si modella come gli altri provider: un ACCOUNT (username+password) = una
 * `corrieri.credenziali`, e OGNI corriere reale è una riga `corrieri` con dentro i suoi CODICI SERVIZIO
 * (servizio/codiceServizio/accessorio_crono), come `carrier_code` per Spedisci. Il nome "Dielle/TWS" NON
 * si mostra mai (regola #8): a video escono i brand (BRT/GLS/UPS).
 *
 * Auth: nel BODY (non header) `{ username, password: <hash>, data }`. La password si hasha con lo schema
 * loro. base_url per ambiente (staging TWS / prod Dielle).
 *
 * ISOLATO: non ancora collegato al flusso di creazione. Le parti marcate "VALIDARE SU STAGING" vanno
 * confermate col primo test reale (schema hash, codifica etichetta, forma tracking).
 */

const BASE = {
  prod: 'https://mydiellebe.it/ws',
  staging: 'https://www.tsm-staging.twssoftware.it:8085/ws',
}

export type DielleCred = {
  username: string
  password: string              // in chiaro in credenziali (protetta), si hasha al momento della chiamata
  ambiente?: 'prod' | 'staging' // default 'prod'
}

function base(c: DielleCred): string { return BASE[c.ambiente === 'staging' ? 'staging' : 'prod'] }

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// Schema Dielle: SHA-256(password), SHA-256(username), si concatenano, poi SHA-256 della concatenazione
// 5 volte. VALIDARE SU STAGING: l'ordine (password+username) e il fatto che si lavori sulle stringhe HEX
// sono l'interpretazione più comune della doc; se l'auth di test fallisce, è il primo posto da rileggere.
export function hashPasswordDielle(username: string, password: string): string {
  let x = sha256(password) + sha256(username)
  for (let i = 0; i < 5; i++) x = sha256(x)
  return x
}

async function chiama(c: DielleCred, path: string, data: unknown): Promise<{ ok: boolean; status: number; j: any }> {
  let r: Response
  try {
    r = await fetch(`${base(c)}/${path}`, {
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
  const data: any = {
    tipoSpedizione: dati.tipoSpedizione || 'Standard',
    servizio: dati.servizio,
    dataSpedizione: dati.dataSpedizione || oggiYmd(),
    numeroOrdine: dati.numeroOrdine || '',
    mittente: recapito(dati.mittente),
    destinatario: recapito(dati.destinatario),
    numerocolli: String(dati.colli.length),
    pesocolli: due(pesoTot),
    colli: dati.colli.map(p => ({ altezza: String(p.altezza ?? ''), larghezza: String(p.larghezza ?? ''), profondita: String(p.profondita ?? ''), peso: due(p.peso) })),
    opzioni: {
      importoContrassegno: dati.contrassegno ? due(dati.contrassegno) : '',
      tipoPagamento: dati.tipoPagamento || '',
      importoAssicurata: dati.assicurata ? due(dati.assicurata) : '',
      codiceServizio: dati.codiceServizio || '',
      accessorio_crono: dati.accessorioCrono || '',
    },
    note: dati.note || '',
  }
  const { ok, status, j } = await chiama(c, 'insSped', data)
  if (!ok) throw new Error(j?.errorMessage || j?.error || `Dielle: errore ${status}`)
  if (j?.errorCode || !j?.ldv) throw new Error(j?.errorMessage || 'Dielle: creazione non riuscita')
  return { ldv: String(j.ldv), raw: j }
}

// Etichetta. formato: 'pdf' (getSpedLdvZebra, PDF Zebra) | 'a4' (getSpedA4) | 'zpl' (getSpedZplZebra).
// La spedizione si identifica passando l'`ldv` come `data` (stringa). VALIDARE SU STAGING la codifica
// del ritorno: la doc dice "byte array"; in JSON arriva o come base64 (stringa) o come array di numeri.
export async function etichettaDielle(c: DielleCred, ldv: string, formato: 'pdf' | 'a4' | 'zpl' = 'pdf'): Promise<{ contentType: string; bytes?: Buffer; zpl?: string }> {
  const path = formato === 'zpl' ? 'getSpedZplZebra' : formato === 'a4' ? 'getSpedA4' : 'getSpedLdvZebra'
  const { ok, status, j } = await chiama(c, path, ldv)
  if (!ok || j?.errorCode) throw new Error(j?.errorMessage || `Dielle: etichetta non disponibile (${status})`)
  if (formato === 'zpl') return { contentType: 'text/plain', zpl: String(j?.ldv || '') }
  const raw = j?.ldv
  const bytes = Array.isArray(raw) ? Buffer.from(raw) : Buffer.from(String(raw || ''), 'base64')
  return { contentType: 'application/pdf', bytes }
}

// Tracking (/extracking/trackingStatus). Forma della richiesta/risposta da VALIDARE SU STAGING: qui si
// passa l'ldv e si torna il grezzo, da normalizzare quando vediamo un tracking reale.
export async function trackingDielle(c: DielleCred, ldv: string): Promise<any> {
  const { ok, status, j } = await chiama(c, 'extracking/trackingStatus', ldv)
  if (!ok) throw new Error(j?.errorMessage || `Dielle: tracking errore ${status}`)
  return j
}
