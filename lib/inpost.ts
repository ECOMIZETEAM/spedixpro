/* Provider INPOST diretto — "Global API" di InPost (developers.inpost-group.com, merchant.inpost-group.com).
 *
 * InPost è un CORRIERE REALE (brand mostrabile a valle, come BRT/GLS diretti). Nuovo `tipo='inpost'`.
 * NB: questa è la Global API NUOVA (OAuth2), NON la vecchia ShipX. Auth: client_credentials → access_token
 * (~10 min), poi Bearer. Base url api.inpost-group.com (prod) / stage-api.inpost-group.com (stage).
 *
 * IMPORTANTE (verificato 30/9 su stage con create+etichetta reali): la create NON usa `brand` né
 * `productVariant` (aggiungerli dà "unknown"). Il servizio si DEDUCE da:
 *   - destinazione: a un PUNTO (locker/PUDO) → `destination.pointId`; a un INDIRIZZO → campi indirizzo.
 *   - origine: da magazzino → indirizzo; da un punto qualsiasi (drop-off) → `origin.shippingMethod:'ANY_POINT'`.
 *   - `priority:'STANDARD'`.
 * Creazione SINCRONA: la 201 torna subito il `trackingNumber`. Etichetta scaricabile subito.
 *
 * Struttura dal template ufficiale InPost Italia (TemplateCreazioneSpedizioni). Punti Italia dalla Location
 * API. Resi su /returns/v1. COD/assicurazione: `valueAddedServices` — l'id del COD NON è documentato, da
 * confermare con InPost prima di usarlo (i locker spesso non gestiscono contrassegno).
 */
import { prioritaStato } from '@/lib/spedisci'

const BASE = {
  prod: 'https://api.inpost-group.com',
  stage: 'https://stage-api.inpost-group.com',
}

export type InpostCred = {
  clientId: string
  secretId: string
  organizationId: string
  ambiente?: 'prod' | 'stage'   // default 'prod'
}

function base(c: InpostCred): string { return BASE[c.ambiente === 'stage' ? 'stage' : 'prod'] }

// ── AUTH (OAuth2 client_credentials) ────────────────────────────────────────────
// Token in cache in-process (scade ~599s): rinnovo con margine. Uno per (ambiente, clientId).
type TokCache = { token: string; scade: number }
const _tok = new Map<string, TokCache>()
const SCOPE = 'openid api:points:read api:shipments:write api:shipments:read api:tracking:read api:returns:write api:returns:read'
async function accessToken(c: InpostCred): Promise<string> {
  const key = `${base(c)}|${c.clientId}`
  const now = Date.now()
  const cached = _tok.get(key)
  if (cached && cached.scade > now + 45_000) return cached.token
  let r: Response
  try {
    r = await fetch(`${base(c)}/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secretId, scope: SCOPE }),
    })
  } catch (e: any) { throw new Error('InPost non raggiungibile: ' + (e?.message || 'rete')) }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j?.access_token) throw new Error(j?.error_description || j?.error || `InPost: token non emesso (${r.status})`)
  _tok.set(key, { token: String(j.access_token), scade: now + (Number(j.expires_in) || 599) * 1000 })
  return String(j.access_token)
}

async function chiama(c: InpostCred, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; j: any }> {
  const tok = await accessToken(c)
  let r: Response
  try {
    r = await fetch(`${base(c)}${path}`, {
      method, headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e: any) { throw new Error('InPost non raggiungibile: ' + (e?.message || 'rete')) }
  const txt = await r.text().catch(() => '')
  let j: any = {}
  try { j = txt ? JSON.parse(txt) : {} } catch { j = { _txt: txt } }
  return { ok: r.ok, status: r.status, j }
}

// Errore Global API: { type, status, title, detail, errors:{campo:[...]} }.
function erroreInpost(j: any, status: number): string {
  const dett = j?.errors && typeof j.errors === 'object'
    ? ' (' + Object.entries(j.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : v}`).join('; ') + ')'
    : ''
  return String(j?.title || j?.detail || j?.error || `InPost: errore ${status}`) + dett
}

export type InpostRecapito = {
  ragioneSociale?: string
  nome?: string
  cognome?: string
  email?: string
  telefono?: string
  indirizzo?: string
  civico?: string
  citta?: string
  cap?: string
  paese?: string
}
export type InpostCollo = { peso: number | string; altezza?: number | string; larghezza?: number | string; profondita?: number | string }

// Telefono in E.164 (+39…): InPost lo vuole col prefisso. Se già col +, passa; altrimenti mette +39.
function tel(v?: string): string | undefined {
  if (!v) return undefined
  const s = String(v).trim()
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/[^0-9]/g, '')
  const d = s.replace(/[^0-9]/g, '')
  return d ? '+39' + d : undefined
}
// InPost richiede SEMPRE firstName E lastName (anche per aziende). Se abbiamo solo un nome unico
// (ragioneSociale/nome), lo splitto; con una parola sola riuso la stessa in cognome (mai vuoto).
function persona(r: InpostRecapito) {
  let first = (r.nome || '').trim(), last = (r.cognome || '').trim()
  if (!first || !last) {
    const full = (r.nome || r.ragioneSociale || 'Cliente').trim()
    const parts = full.split(/\s+/).filter(Boolean)
    if (!first) first = parts[0] || 'Cliente'
    if (!last) last = parts.slice(1).join(' ') || parts[0] || first
  }
  return { companyName: r.ragioneSociale || undefined, firstName: first.slice(0, 60), lastName: last.slice(0, 60), email: r.email || undefined, phone: tel(r.telefono) }
}
function indirizzo(r: InpostRecapito) {
  return { street: r.indirizzo || '', houseNumber: r.civico || '', city: r.citta || '', postalCode: r.cap || '', countryCode: (r.paese || 'IT').toUpperCase() }
}

export type InpostSpedInput = {
  mittente: InpostRecapito
  destinatario: InpostRecapito
  colli: InpostCollo[]
  pointIdDestinazione?: string      // se valorizzato → consegna a LOCKER/PUDO (altrimenti a domicilio)
  origineDaPunto?: boolean          // true → il mittente deposita in un punto qualsiasi (shippingMethod ANY_POINT)
  reference?: string
  note?: string
  dropOffCode?: boolean             // label-less
}

// Box locker InPost: Piccola 8×38×64, Media 19×38×64, Grande 41×38×64 cm. Il collo entra nel Grande
// (il più capiente) se i suoi lati ORDINATI stanno in 38×41×64. È il vincolo che decide se un pacco è
// spedibile a locker: sta qui, nel punto che TUTTE le porte attraversano (portale, API v1, import, negozi),
// non solo nella creazione dal portale.
const LOCKER_MAX_ORDINATO = [38, 41, 64]
export function entraNelLockerInpost(collo: InpostCollo): boolean {
  const d = [Number(collo.altezza) || 0, Number(collo.larghezza) || 0, Number(collo.profondita) || 0].sort((a, b) => a - b)
  return d[0] <= LOCKER_MAX_ORDINATO[0] && d[1] <= LOCKER_MAX_ORDINATO[1] && d[2] <= LOCKER_MAX_ORDINATO[2]
}

// Crea la spedizione (sincrona). Torna { trackingNumber, raw }.
export async function creaSpedizioneInpost(c: InpostCred, dati: InpostSpedInput): Promise<{ trackingNumber: string; raw: any }> {
  // A LOCKER (pointId valorizzato): il collo deve entrare nel box più grande, altrimenti non è spedibile
  // a locker e verrebbe venduto a tariffa taglia inesistente. A domicilio (senza pointId) nessun limite.
  if (dati.pointIdDestinazione) {
    const fuori = dati.colli.find((p) => !entraNelLockerInpost(p))
    if (fuori) throw new Error(`Pacco troppo grande per un locker InPost (box massimo 41×38×64 cm): ${Math.round(Number(fuori.profondita) || 0)}×${Math.round(Number(fuori.larghezza) || 0)}×${Math.round(Number(fuori.altezza) || 0)} cm. Scegli la consegna a domicilio o riduci le misure.`)
  }
  const parcels = dati.colli.map((p) => ({
    type: 'STANDARD',
    dimensions: { height: Math.max(1, Math.round(Number(p.altezza) || 0)) || 1, width: Math.max(1, Math.round(Number(p.larghezza) || 0)) || 1, length: Math.max(1, Math.round(Number(p.profondita) || 0)) || 1, unit: 'CM' },
    weight: { amount: Math.max(0.1, Number(p.peso) || 0.1), unit: 'KG' },
    ...(dati.reference ? { remarks: { label: [{ type: 'PLAIN_TEXT', content: String(dati.reference).slice(0, 30) }] } } : {}),
  }))
  const body: any = {
    enableDropOffCode: !!dati.dropOffCode,
    sender: persona(dati.mittente),
    recipient: persona(dati.destinatario),
    // ORIGINE: da magazzino (indirizzo) o da punto qualsiasi (drop-off).
    origin: dati.origineDaPunto ? { countryCode: (dati.mittente.paese || 'IT').toUpperCase(), shippingMethod: 'ANY_POINT' } : indirizzo(dati.mittente),
    // DESTINAZIONE: a un punto (pointId) o a un indirizzo.
    destination: dati.pointIdDestinazione ? { countryCode: (dati.destinatario.paese || 'IT').toUpperCase(), pointId: dati.pointIdDestinazione } : indirizzo(dati.destinatario),
    parcels,
  }
  // priority richiesta negli scenari "to point"; innocua altrove.
  if (dati.pointIdDestinazione) body.priority = 'STANDARD'
  if (dati.reference || dati.note) body.references = { custom: { ...(dati.reference ? { orderReference: String(dati.reference) } : {}), ...(dati.note ? { note: String(dati.note).slice(0, 200) } : {}) } }

  const { ok, status, j } = await chiama(c, 'POST', `/shipping/v2/organizations/${c.organizationId}/shipments`, body)
  if (!ok || !j?.trackingNumber) throw new Error(erroreInpost(j, status))
  return { trackingNumber: String(j.trackingNumber), raw: j }
}

// Etichetta. Il formato si sceglie con l'header Accept: application/pdf;format=A6|A4 oppure text/zpl;dpi=203.
export async function etichettaInpost(c: InpostCred, trackingNumber: string, formato: 'pdf' | 'zpl' = 'pdf', size: 'A6' | 'A4' = 'A6'): Promise<{ contentType: string; bytes?: Buffer; zpl?: string }> {
  const accept = formato === 'zpl' ? 'text/zpl;dpi=203' : `application/pdf;format=${size}`
  const tok = await accessToken(c)
  const r = await fetch(`${base(c)}/shipping/v2/organizations/${c.organizationId}/shipments/${encodeURIComponent(trackingNumber)}/label`, { headers: { 'Authorization': `Bearer ${tok}`, 'Accept': accept } })
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`InPost: etichetta non disponibile (${r.status})${t ? ' ' + t.slice(0, 120) : ''}`) }
  if (formato === 'zpl') return { contentType: 'text/plain', zpl: await r.text() }
  return { contentType: 'application/pdf', bytes: Buffer.from(await r.arrayBuffer()) }
}

// ── STATI (tracking events) ──────────────────────────────────────────────────
// Si legge l'`eventCode` (il campo `status` testuale arriva sempre vuoto). La mappa segue il catalogo
// ufficiale di InPost, 108 codici (developers.inpost-group.com/tracking-events, letto il 23/11/2026), codice
// per codice: il prefisso da solo non basta.
//
// GUASTO VERO (23/11/2026). La vecchia mappa andava per prefisso e leggeva ogni LMD come "in consegna".
// Ma LMD.3014 vuol dire "il destinatario ha chiesto il locker", e InPost lo emette anche subito dopo la
// creazione: 870023025621049560607425 (2/10) ha solo CRE.1001 e LMD.3014, InPost non l'ha mai ritirato, e da
// noi era "In consegna" da sette settimane (come altri due Locker e un Domicilio fermo a "Spedita" per FMD).
// E i promemoria del locker (LMD.9001, "il pacco ti aspetta") diventavano "Non consegnato" mentre il pacco
// era li' da ritirare. Il ciclo del tracking fa solo avanzare lo stato: un evento letto troppo avanti non
// torna indietro da solo, percio' un codice che non dice dove sta il pacco qui torna null.
const STATO_INPOST: Record<string, string | null> = {
  // primo miglio: solo il ritiro vero fa partire il pacco
  'FMD.1002': 'spedita',
  // centri di smistamento, passaggi di mano, dogana
  'MMD.1001': 'in_transito', 'MMD.1002': 'in_transito', 'MMD.1003': 'in_transito', 'MMD.1004': 'in_transito',
  'MMD.1006': 'in_transito', 'MMD.1008': 'in_transito', 'HAN.1001': 'in_transito', 'HAN.1002': 'in_transito',
  'CC.001': 'in_transito', 'CC.002': 'in_transito', 'CC.003': 'in_transito',
  // ultimo miglio: in giro per la consegna o arrivato al punto, che aspetta il destinatario
  'LMD.1001': 'in_consegna', 'LMD.1002': 'in_consegna', 'LMD.1009': 'in_consegna',
  'LMD.1003': 'in_consegna', 'LMD.1004': 'in_consegna', 'LMD.1005': 'in_consegna', 'LMD.1010': 'in_consegna',
  'LMD.3004': 'in_consegna', 'LMD.3007': 'in_consegna', 'LMD.9012': 'in_consegna', 'LMD.9013': 'in_consegna',
  'LMD.9001': 'in_consegna', 'LMD.9032': 'in_consegna', 'LMD.9033': 'in_consegna', 'LMD.9035': 'in_consegna',
  // consegna non riuscita o non ritirato in tempo (il reso, se parte, arriva coi codici RTS)
  'LMD.9002': 'non_consegnato', 'LMD.3009': 'non_consegnato', 'LMD.9003': 'non_consegnato',
  'LMD.9004': 'non_consegnato', 'LMD.9005': 'non_consegnato', 'LMD.9006': 'non_consegnato',
  'LMD.9007': 'non_consegnato', 'LMD.9008': 'non_consegnato', 'LMD.9009': 'non_consegnato',
  'LMD.9010': 'non_consegnato', 'LMD.9014': 'non_consegnato', 'LMD.9015': 'non_consegnato',
  'LMD.9016': 'non_consegnato', 'LMD.9017': 'non_consegnato', 'LMD.9018': 'non_consegnato',
  'LMD.9019': 'non_consegnato', 'LMD.9027': 'non_consegnato', 'LMD.9028': 'non_consegnato',
  'LMD.9030': 'non_consegnato',
  // esito finale. EOL.1009 e' un passaggio a un altro vettore, non una consegna.
  'EOL.1001': 'consegnata', 'EOL.1002': 'consegnata', 'EOL.1003': 'consegnata', 'EOL.1004': 'consegnata',
  'EOL.1005': 'consegnata', 'EOL.1006': 'consegnata', 'EOL.1007': 'consegnata', 'EOL.1008': 'consegnata',
  'EOL.9001': 'non_consegnato', 'EOL.9002': 'non_consegnato', 'EOL.9003': 'non_consegnato', 'EOL.9004': 'annullata',
  'RTS.1001': 'reso_mittente', 'RTS.1002': 'reso_mittente',
  // tutto il resto (CRE, FMD.1001 "da ritirare", i dirottamenti LMD.30xx, INF, FUL, EOL.1009, i codici
  // operativi dei punti) non sposta lo stato
}
export function mapStatoInpost(eventCode: string): string | null {
  return STATO_INPOST[String(eventCode || '').toUpperCase().trim()] ?? null
}

// Le descrizioni in italiano dei codici che InPost usa in Italia (nomi del catalogo ufficiale). Gli altri
// ripiegano sul prefisso.
const DESCR_INPOST: Record<string, string> = {
  'CRE.1001': 'Spedizione registrata',
  'FMD.1001': 'In attesa del ritiro del corriere', 'FMD.1002': 'Ritirata dal corriere',
  'MMD.1001': 'Arrivata al centro di smistamento', 'MMD.1002': 'Lavorata al centro di smistamento',
  'MMD.1003': 'Partita dal centro di smistamento', 'MMD.1004': 'In viaggio',
  'LMD.1001': 'In consegna', 'LMD.1002': 'Arrivata a destinazione', 'LMD.1003': 'Pronta per il ritiro',
  'LMD.1004': 'Pronta per il ritiro al punto InPost', 'LMD.1005': 'Pronta per il ritiro nel locker',
  'LMD.3001': 'Assegnato un altro punto di ritiro', 'LMD.3006': 'Consegna spostata a un nuovo indirizzo o punto',
  'LMD.3013': 'Il destinatario ha scelto il ritiro in un punto InPost', 'LMD.3014': 'Il destinatario ha scelto il ritiro in un locker',
  'LMD.9001': 'Promemoria: pacco in attesa di ritiro', 'LMD.9002': 'Tempo per il ritiro scaduto',
  'LMD.9004': 'Tentativo di consegna non riuscito', 'LMD.9005': 'Non consegnabile',
  'LMD.9006': 'Rifiutata dal destinatario', 'LMD.9007': 'Dati di consegna errati', 'LMD.9008': 'Destinatario sconosciuto',
  'LMD.9012': 'Pronta per il ritiro in un locker temporaneo', 'LMD.9013': 'Pronta per il ritiro al punto dopo il tentativo di consegna',
  'LMD.9014': 'Non ritirata: avviato il ritorno al mittente',
  'LMD.9015': 'Tentativo non riuscito: indirizzo errato', 'LMD.9016': 'Tentativo non riuscito: luogo non accessibile',
  'LMD.9017': 'Tentativo non riuscito: nessuno ha risposto',
  'INF.9001': 'Possibile ritardo nella consegna',
  'EOL.1001': 'Consegnata', 'EOL.1002': 'Ritirata dal destinatario', 'EOL.1003': 'Consegnata in luogo sicuro',
  'EOL.1004': 'Consegnata a un vicino', 'EOL.1005': 'Consegnata con verifica del destinatario',
  'EOL.9001': 'Smarrita', 'EOL.9002': 'Danneggiata', 'EOL.9003': 'Distrutta', 'EOL.9004': 'Annullata',
  'RTS.1001': 'In ritorno al mittente', 'RTS.1002': 'Tornata al mittente',
}
const DESCR_PREFIX: Record<string, string> = {
  CRE: 'Spedizione registrata', FMD: 'Ritiro / primo miglio', MMD: 'In transito', HAN: 'Presa in carico',
  LMD: 'Consegna', FUL: 'In magazzino', INF: 'Aggiornamento', EOL: 'Esito finale', RTS: 'Reso al mittente', CC: 'Dogana',
}

// Tracking. `GET /tracking/v1/parcels?trackingNumbers=...` (max 10). Torna { stati, consegnata, eventi }.
export async function trackingInpost(c: InpostCred, trackingNumber: string): Promise<{ stati: string[]; consegnata: boolean; eventi: { data: string; descrizione: string; luogo: string }[] }> {
  const { ok, status, j } = await chiama(c, 'GET', `/tracking/v1/parcels?trackingNumbers=${encodeURIComponent(trackingNumber)}`)
  if (!ok) throw new Error(erroreInpost(j, status))
  const parcel = (Array.isArray(j?.parcels) ? j.parcels : []).find((p: any) => String(p?.trackingNumber || '') === String(trackingNumber)) || (Array.isArray(j?.parcels) ? j.parcels[0] : null)
  const eventiRaw: any[] = Array.isArray(parcel?.events) ? parcel.events : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  for (const ev of eventiRaw) {
    const code = String(ev?.eventCode || '')
    const st = mapStatoInpost(code)
    if (st) stati.push(st)
    const quando = String(ev?.eventTimestamp || '').trim()   // ISO con fuso → istanteDaTesto lo gestisce
    const descr = String(DESCR_INPOST[code.toUpperCase()] || ev?.status || DESCR_PREFIX[code.split('.')[0]] || code || '').trim()
    const luogo = String(ev?.location?.name || ev?.location?.city || '').trim()
    if (quando && descr) eventi.push({ data: quando, descrizione: descr, luogo })
  }
  const consegnata = stati.some((s) => s === 'consegnata')
  return { stati, consegnata, eventi }
}

// ── RESI (Returns API) ───────────────────────────────────────────────────────
// Crea una spedizione di RESO (/returns/v1/organizations/{org}/shipments). Il cliente (sender) rimanda al
// magazzino/merchant (recipient+destination). `dropOffCode:true` = reso SENZA etichetta (label-less).
// `expirationDate` obbligatoria, 7-720 giorni avanti. `trackingOriginale` = LDV della spedizione andata (opz).
// Il cliente riceve via email l'etichetta di reso. Torna il trackingNumber del reso.
export async function creaResoInpost(c: InpostCred, req: {
  cliente: InpostRecapito           // chi rende (sender)
  magazzino: InpostRecapito         // dove torna (recipient + destination address)
  colli: InpostCollo[]
  trackingOriginale?: string
  orderReference?: string
  senzaEtichetta?: boolean
  scadenzaGiorni?: number           // default 30
}): Promise<{ trackingNumber: string; raw: any }> {
  const giorni = Math.min(720, Math.max(7, req.scadenzaGiorni || 30))
  const scad = new Date(Date.now() + giorni * 86400000).toISOString().replace(/\.\d+Z$/, '+00:00')
  const body: any = {
    sender: persona(req.cliente),
    recipient: persona(req.magazzino),
    origin: { countryCode: (req.cliente.paese || 'IT').toUpperCase() },
    destination: indirizzo(req.magazzino),
    references: { ...(req.orderReference ? { orderReference: String(req.orderReference) } : {}) },
    enableDropOffCode: !!req.senzaEtichetta,
    parcels: req.colli.map((p) => ({
      weight: { amount: Math.max(0.1, Number(p.peso) || 0.1), unit: 'KG' },
      dimensions: { length: Math.max(1, Math.round(Number(p.profondita) || 0)) || 1, width: Math.max(1, Math.round(Number(p.larghezza) || 0)) || 1, height: Math.max(1, Math.round(Number(p.altezza) || 0)) || 1, unit: 'CM' },
      contents: 'reso',
      ...(req.trackingOriginale ? { trackingNumber: String(req.trackingOriginale) } : {}),
    })),
    expirationDate: scad,
  }
  const { ok, status, j } = await chiama(c, 'POST', `/returns/v1/organizations/${c.organizationId}/shipments`, body)
  if (!ok || !j?.trackingNumber) throw new Error(erroreInpost(j, status))
  return { trackingNumber: String(j.trackingNumber), raw: j }
}
// Etichetta del reso (PDF). Disponibile solo per i resi CON etichetta (non label-less).
export async function etichettaResoInpost(c: InpostCred, trackingNumber: string): Promise<{ contentType: string; bytes?: Buffer }> {
  const tok = await accessToken(c)
  const r = await fetch(`${base(c)}/returns/v1/organizations/${c.organizationId}/shipments/${encodeURIComponent(trackingNumber)}/label`, { headers: { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/pdf' } })
  if (!r.ok) throw new Error(`InPost: etichetta reso non disponibile (${r.status})`)
  return { contentType: 'application/pdf', bytes: Buffer.from(await r.arrayBuffer()) }
}

// ── PUNTI / LOCKER (Location API) ────────────────────────────────────────────
export type InpostPunto = { id: string; nome: string; tipo: string; indirizzo: string; citta: string; cap: string; lat?: number; lng?: number; h247?: boolean }
// Cerca i punti (APM=locker, PUDO) vicino a coordinate o CAP. Il `id` del punto va in pointIdDestinazione.
export async function puntiInpost(c: InpostCred, filtro: { lat?: number; lng?: number; cap?: string; maxDistanza?: number; tipo?: string; limite?: number }): Promise<InpostPunto[]> {
  const q = new URLSearchParams()
  if (filtro.lat != null && filtro.lng != null) { q.set('relativePoint', `${filtro.lat},${filtro.lng}`); q.set('maxDistance', String(filtro.maxDistanza || 10000)) }
  else if (filtro.cap) { q.set('relativePostCode', filtro.cap) }
  q.set('address.country', 'IT')
  if (filtro.tipo) q.set('type', filtro.tipo)   // APM | PUDO
  q.set('perPage', String(filtro.limite || 30))
  const usaProssimita = filtro.lat != null || filtro.cap
  const path = usaProssimita ? `/location/v1/points/search-by-location?${q}` : `/location/v1/points?${q}`
  const { ok, status, j } = await chiama(c, 'GET', path)
  if (!ok) throw new Error(erroreInpost(j, status))
  const items: any[] = Array.isArray(j?.items) ? j.items : []
  return items.map((p) => ({
    id: String(p?.id || ''), nome: String(p?.address?.street ? `${p.address.street} ${p.address.buildingNumber || ''}`.trim() : p?.id || ''),
    tipo: String(p?.type || ''), indirizzo: String(p?.address?.street ? `${p.address.street} ${p.address.buildingNumber || ''}`.trim() : ''),
    citta: String(p?.address?.city || ''), cap: String(p?.address?.postalCode || ''),
    lat: p?.coordinates?.latitude, lng: p?.coordinates?.longitude, h247: p?.location247 === true,
  }))
}
