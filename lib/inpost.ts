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

// Crea la spedizione (sincrona). Torna { trackingNumber, raw }.
export async function creaSpedizioneInpost(c: InpostCred, dati: InpostSpedInput): Promise<{ trackingNumber: string; raw: any }> {
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
// La Tracking API torna `eventCode` (prefissi: CRE creazione, FMD primo miglio, MMD mid-mile, LMD ultimo
// miglio, HAN handover, FUL magazzino, INF informativo, EOL fine vita, RTS reso, CC dogana). Si mappa sul
// PREFISSO + i codici terminali noti (EOL.1xxx=consegnata, EOL.9xxx=terminale negativo, RTS=reso). Il campo
// `status` testuale è spesso null → si usa l'eventCode. NB: da affinare col catalogo completo (~114 codici).
export function mapStatoInpost(eventCode: string, statusTesto?: string): string | null {
  const e = String(eventCode || '').toUpperCase().trim()
  const s = String(statusTesto || '').toLowerCase()
  if (!e && !s) return null
  if (e.startsWith('RTS') || /return.*sender|reso/.test(s)) return 'reso_mittente'
  if (/^EOL\.1\d/.test(e) || (s.includes('deliver') && !s.includes('out for'))) return 'consegnata'
  if (/^EOL\.900?4/.test(e) || s.includes('cancel')) return 'annullata'
  if (e.startsWith('EOL.9') || /lost|damaged|destroyed|prohibited|rejected|undeliver/.test(s)) return 'non_consegnato'
  if (/^LMD\.9/.test(e)) return 'non_consegnato'                                  // fallback ultimo miglio
  if (e.startsWith('LMD') || /ready_to_pickup|out_for_delivery|in consegna/.test(s)) return 'in_consegna'
  if (e.startsWith('MMD') || e.startsWith('HAN') || e.startsWith('CC')) return 'in_transito'
  if (e.startsWith('FMD')) return 'spedita'
  if (e.startsWith('CRE')) return 'in_lavorazione'
  return null   // FUL/INF e ignoti: nessun cambio stato
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
    const st = mapStatoInpost(code, ev?.status)
    if (st) stati.push(st)
    const quando = String(ev?.eventTimestamp || '').trim()   // ISO con fuso → istanteDaTesto lo gestisce
    const descr = String(ev?.status || DESCR_PREFIX[code.split('.')[0]] || code || '').trim()
    const luogo = String(ev?.location?.name || ev?.location?.city || '').trim()
    if (quando && descr) eventi.push({ data: quando, descrizione: descr, luogo })
  }
  const consegnata = stati.some((s) => s === 'consegnata')
  return { stati, consegnata, eventi }
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
