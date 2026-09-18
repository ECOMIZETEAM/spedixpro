// ─────────────────────────────────────────────────────────────────────────────
// FedEx — REST API DIRETTA (contratto proprio del master), sullo stampo di lib/brt.ts e lib/gls.ts.
//
// Endpoint produzione: https://apis.fedex.com  ·  sandbox (test mode): https://apis-sandbox.fedex.com
// (JSON, OAuth2 client_credentials). Operazioni che servono:
//
//  • POST /oauth/token           — token Bearer (scade in ~3600s). Le chiavi sono client_id/client_secret
//      del progetto Ship. FedEx può avere un progetto Track SEPARATO (chiavi diverse): se il contratto le
//      porta (track_api_key/secret) il tracking usa quelle, altrimenti riusa le chiavi Ship.
//  • POST /ship/v1/shipments     — crea la spedizione e RESTITUISCE GIÀ l'etichetta (encodedLabel base64),
//      una per collo, come BRT (a differenza del GLS che la vuole a parte). Torna masterTrackingNumber
//      (il tracking del cliente) e un trackingNumber per collo. FedEx auto-conferma alla creazione: non
//      esiste una "chiusura" tipo GLS CloseWorkDay — il ritiro è programmato a parte sul conto (pickupType).
//  • PUT  /ship/v1/shipments/cancel — annulla per accountNumber + trackingNumber. FedEx AUTO-CONFERMA
//      (come BRT): l'annullo va tentato DAVVERO, mai un rimborso a vuoto se il pacco viaggia.
//  • POST /track/v1/trackingnumbers — stato di consegna. Torna scanEvents + latestStatusDetail.code.
//
// STATO: struttura scritta contro la specifica REST FedEx pubblica. Come BRT/GLS al loro esordio, va
// VERIFICATA sull'API vera con una create+etichetta+annullo di prova al primo contratto reale (MULTIEXPRESS
// ne inserirà uno a breve): finché non esiste un contratto tipo='fedex' questo codice non è su nessuna porta.
//
// Regola fissa: le credenziali di produzione stanno in corrieri.credenziali (dal pannello), MAI in chat.
// Qui arrivano già lette da chi chiama.
// ─────────────────────────────────────────────────────────────────────────────

import { testoIndicaReso } from '@/lib/spedisci'

const FEDEX_PROD = 'https://apis.fedex.com'
const FEDEX_TEST = 'https://apis-sandbox.fedex.com'

export type CredenzialiFedex = {
  api_key?: string          // client_id progetto Ship
  api_secret?: string       // client_secret progetto Ship
  account_number?: string   // numero conto spedizione (accountNumber.value)
  track_api_key?: string    // client_id progetto Track (facoltativo: se assente si riusa Ship)
  track_api_secret?: string // client_secret progetto Track (facoltativo)
}

export type ColloFedex = { pesoKg: number; lunghezza?: number; larghezza?: number; altezza?: number }

export type ParcelFedex = {
  // MITTENTE (shipFrom): FedEx lo vuole esplicito nella create (non lo deduce dal conto).
  mittRagioneSociale: string
  mittIndirizzo: string
  mittLocalita: string
  mittCap: string
  mittProvincia: string
  mittPaese?: string        // ISO alpha-2, default IT
  mittContatto?: string
  mittTelefono?: string
  // DESTINATARIO (shipTo)
  ragioneSociale: string
  indirizzo: string
  localita: string
  cap: string
  provincia: string
  paese?: string            // ISO alpha-2, default IT
  contatto?: string
  telefono?: string
  email?: string
  residenziale?: boolean     // incide sui servizi domestici (Ground vs Home Delivery)
  // UN COLLO PER ELEMENTO (peso kg + misure cm). FedEx crea un requestedPackageLineItem per collo.
  colli: ColloFedex[]
  importoContrassegno?: number   // EUR (COD)
  codContanti?: boolean          // true=contanti, false=fondi garantiti (assegno)
  valoreDoganale?: number        // EUR, per l'estero (customs)
  contenuto?: string             // descrizione merce, per l'estero (customs)
  note?: string
  rifOrdine?: string             // customerReferences
  serviceType: string            // es. FEDEX_REGIONAL_ECONOMY (dal contratto)
  pickupType?: string            // es. USE_SCHEDULED_PICKUP (dal contratto)
  sabato?: boolean               // SATURDAY_DELIVERY
  test?: boolean                 // sandbox
}

export type RisultatoFedex = {
  tracking: string | null        // masterTrackingNumber = tracking mostrato al cliente
  trackingNumbers: string[]      // uno per collo
  etichette: string[]            // base64 (PDF), una per collo
  numeroColli: number
  errore: string | null
  warning: string | null
  raw: string
}

function num(v: unknown): number | undefined {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : undefined
}
function s(v: unknown, max: number): string {
  return String(v ?? '').trim().substring(0, max)
}
function baseUrl(test?: boolean): string { return test ? FEDEX_TEST : FEDEX_PROD }

// Cache token per istanza calda (chiave = base+client_id). FedEx dà ~3600s: si riusa finché manca >60s
// alla scadenza, così due operazioni ravvicinate non chiedono due token. Non serve persistenza: a freddo
// se ne prende uno nuovo. Niente Date.now problematico qui (siamo in un modulo runtime normale).
const _tokenCache = new Map<string, { token: string; scadeMs: number }>()

async function getToken(clientId: string, clientSecret: string, test?: boolean): Promise<string> {
  const chiave = `${baseUrl(test)}:${clientId}`
  const cached = _tokenCache.get(chiave)
  if (cached && cached.scadeMs - Date.now() > 60000) return cached.token
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`${baseUrl(test)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(), signal: ctrl.signal,
    })
    const txt = await res.text()
    let j: any = null; try { j = JSON.parse(txt) } catch { /* non-JSON */ }
    const token = j?.access_token
    if (!token) throw new Error(j?.errors?.[0]?.message || j?.error_description || `token FedEx non ottenuto (HTTP ${res.status})`)
    const expires = num(j?.expires_in) || 3600
    _tokenCache.set(chiave, { token, scadeMs: Date.now() + expires * 1000 })
    return token
  } finally {
    clearTimeout(t)
  }
}

async function chiamaFedex(
  token: string, path: string, body: unknown, method: 'POST' | 'PUT' = 'POST', test?: boolean, timeoutMs = 30000
): Promise<{ status: number; j: any; txt: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl(test)}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-locale': 'it_IT',
      },
      body: JSON.stringify(body), signal: ctrl.signal,
    })
    const txt = await res.text()
    let j: any = null; try { j = JSON.parse(txt) } catch { /* non-JSON */ }
    return { status: res.status, j, txt }
  } finally {
    clearTimeout(t)
  }
}

// Messaggio d'errore leggibile dai FedEx { errors: [{ code, message }] }.
function erroreFedex(j: any, status: number): string {
  const e = j?.errors?.[0]
  if (e) return `${e.message || e.code || 'errore'}${e.code ? ` (${e.code})` : ''}`.trim()
  return `FedEx: risposta non valida (HTTP ${status})`
}

const EMPTY: RisultatoFedex = {
  tracking: null, trackingNumbers: [], etichette: [], numeroColli: 0, errore: null, warning: null, raw: '',
}

function contatto(nome: string, tel?: string, azienda?: string) {
  const c: any = { personName: s(nome, 70) }
  if (azienda) c.companyName = s(azienda, 70)
  const telePulito = String(tel || '').replace(/[^\d+]/g, '')
  if (telePulito) c.phoneNumber = telePulito.substring(0, 15)
  return c
}
function indirizzo(via: string, citta: string, prov: string, cap: string, paese: string, residenziale?: boolean) {
  return {
    streetLines: [s(via, 35)].filter(Boolean),
    city: s(citta, 35),
    stateOrProvinceCode: s(prov, 2).toUpperCase() || undefined,
    postalCode: s(cap, 10),
    countryCode: (s(paese, 2) || 'IT').toUpperCase(),
    residential: !!residenziale,
  }
}

// Crea una spedizione FedEx (+ etichette). Torna tracking/etichette o l'errore FedEx.
export async function creaSpedizioneFedex(cred: CredenzialiFedex, p: ParcelFedex): Promise<RisultatoFedex> {
  if (!cred.api_key || !cred.api_secret || !cred.account_number) {
    return { ...EMPTY, errore: 'Credenziali FedEx incomplete' }
  }
  let token: string
  try {
    token = await getToken(cred.api_key, cred.api_secret, p.test)
  } catch (e) {
    return { ...EMPTY, errore: 'FedEx (autenticazione): ' + (e instanceof Error ? e.message : String(e)) }
  }

  const paeseDest = (s(p.paese, 2) || 'IT').toUpperCase()
  const paeseMitt = (s(p.mittPaese, 2) || 'IT').toUpperCase()
  const estero = paeseDest !== paeseMitt
  const conCod = !!(p.importoContrassegno && p.importoContrassegno > 0)
  const colli = (p.colli && p.colli.length) ? p.colli : [{ pesoKg: 1 }]

  const packageLineItems = colli.map((c) => {
    const item: any = { weight: { units: 'KG', value: Number((c.pesoKg > 0 ? c.pesoKg : 1).toFixed(2)) } }
    const l = num(c.lunghezza), w = num(c.larghezza), h = num(c.altezza)
    if (l && w && h) item.dimensions = { length: Math.round(l), width: Math.round(w), height: Math.round(h), units: 'CM' }
    return item
  })

  const specialTypes: string[] = []
  if (p.sabato) specialTypes.push('SATURDAY_DELIVERY')
  if (conCod) specialTypes.push('COD')

  // shipDatestamp = oggi (YYYY-MM-DD). Il ritiro effettivo dipende dal pickupType del contratto.
  const oggi = new Date().toISOString().slice(0, 10)

  const requestedShipment: any = {
    shipper: {
      contact: contatto(p.mittContatto || p.mittRagioneSociale, p.mittTelefono, p.mittRagioneSociale),
      address: indirizzo(p.mittIndirizzo, p.mittLocalita, p.mittProvincia, p.mittCap, paeseMitt, false),
    },
    recipients: [{
      contact: contatto(p.contatto || p.ragioneSociale, p.telefono, p.ragioneSociale),
      address: indirizzo(p.indirizzo, p.localita, p.provincia, p.cap, paeseDest, p.residenziale),
    }],
    shipDatestamp: oggi,
    serviceType: p.serviceType,
    packagingType: 'YOUR_PACKAGING',
    pickupType: p.pickupType || 'USE_SCHEDULED_PICKUP',
    blockInsightVisibility: false,
    shippingChargesPayment: { paymentType: 'SENDER' },
    labelSpecification: { imageType: 'PDF', labelStockType: 'PAPER_4X6' },
    totalPackageCount: packageLineItems.length,
    requestedPackageLineItems: packageLineItems,
  }
  if (specialTypes.length) {
    requestedShipment.shipmentSpecialServices = { specialServiceTypes: specialTypes }
    if (conCod) {
      requestedShipment.shipmentSpecialServices.shipmentCODDetail = {
        codCollectionAmount: { amount: Number(p.importoContrassegno!.toFixed(2)), currency: 'EUR' },
        codCollectionType: p.codContanti === false ? 'GUARANTEED_FUNDS' : 'CASH',
      }
    }
  }
  if (p.rifOrdine) {
    // Riferimento ordine come customerReference su ogni collo (compare in fattura/tracking FedEx).
    requestedShipment.requestedPackageLineItems = packageLineItems.map((it: any) => ({
      ...it, customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: s(p.rifOrdine, 30) }],
    }))
  }
  // ESTERO: FedEx pretende la dogana. Blocco MINIMO (una commodity dal contenuto, valore dichiarato):
  // sufficiente a non farsi rifiutare, ma da rivedere quando arriverà un contratto internazionale reale.
  if (estero) {
    const valore = Number((p.valoreDoganale && p.valoreDoganale > 0 ? p.valoreDoganale : 1).toFixed(2))
    const pesoTot = colli.reduce((t, c) => t + (c.pesoKg > 0 ? c.pesoKg : 1), 0)
    requestedShipment.customsClearanceDetail = {
      dutiesPayment: { paymentType: 'SENDER' },
      commodities: [{
        description: s(p.contenuto || 'Merce', 35),
        countryOfManufacture: paeseMitt,
        quantity: 1, quantityUnits: 'PCS',
        weight: { units: 'KG', value: Number(pesoTot.toFixed(2)) },
        unitPrice: { amount: valore, currency: 'EUR' },
        customsValue: { amount: valore, currency: 'EUR' },
      }],
    }
  }

  const body = {
    labelResponseOptions: 'LABEL',
    accountNumber: { value: String(cred.account_number) },
    requestedShipment,
  }

  let r: { status: number; j: any; txt: string }
  try {
    r = await chiamaFedex(token, '/ship/v1/shipments', body, 'POST', p.test)
  } catch (e) {
    return { ...EMPTY, errore: 'FedEx non raggiungibile: ' + (e instanceof Error ? e.message : String(e)) }
  }
  const out = r.j?.output
  const ts = Array.isArray(out?.transactionShipments) ? out.transactionShipments[0] : null
  if (!ts || (r.status >= 400)) {
    return { ...EMPTY, errore: erroreFedex(r.j, r.status), raw: (r.txt || '').substring(0, 2000) }
  }
  const pieces: any[] = Array.isArray(ts.pieceResponses) ? ts.pieceResponses : []
  const trackingNumbers: string[] = []
  const etichette: string[] = []
  for (const pr of pieces) {
    const tn = String(pr?.trackingNumber || '').trim(); if (tn) trackingNumbers.push(tn)
    for (const doc of (Array.isArray(pr?.packageDocuments) ? pr.packageDocuments : [])) {
      const b64 = String(doc?.encodedLabel || '').replace(/\s+/g, ''); if (b64) etichette.push(b64)
    }
  }
  const master = String(ts?.masterTrackingNumber || trackingNumbers[0] || '').trim() || null
  if (!master) {
    return { ...EMPTY, errore: erroreFedex(r.j, r.status) || 'FedEx: nessun tracking restituito', raw: (r.txt || '').substring(0, 2000) }
  }
  const alerts = Array.isArray(ts?.alerts) ? ts.alerts.map((a: any) => a?.message).filter(Boolean).join(' — ') : ''
  return {
    tracking: master,
    trackingNumbers: trackingNumbers.length ? trackingNumbers : [master],
    etichette,
    numeroColli: colli.length,
    errore: null,
    warning: alerts || null,
    raw: (r.txt || '').substring(0, 2000),
  }
}

// Annulla una spedizione FedEx (PUT /ship/v1/shipments/cancel). Torna true se FedEx conferma l'annullo
// (o se risulta già annullata/inesistente). FedEx auto-conferma: l'esito conta (mai rimborso a vuoto).
export async function annullaSpedizioneFedex(
  cred: CredenzialiFedex, trackingNumber: string, test?: boolean
): Promise<{ ok: boolean; errore: string | null }> {
  const tn = String(trackingNumber || '').trim()
  if (!tn) return { ok: false, errore: 'tracking mancante' }
  if (!cred.api_key || !cred.api_secret || !cred.account_number) return { ok: false, errore: 'credenziali FedEx incomplete' }
  let token: string
  try { token = await getToken(cred.api_key, cred.api_secret, test) }
  catch (e) { return { ok: false, errore: 'FedEx (autenticazione): ' + (e instanceof Error ? e.message : String(e)) } }
  try {
    const r = await chiamaFedex(token, '/ship/v1/shipments/cancel', {
      accountNumber: { value: String(cred.account_number) },
      trackingNumber: tn,
      deletionControl: 'DELETE_ALL_PACKAGES',
    }, 'PUT', test)
    if (r.status < 400 && (r.j?.output?.cancelledShipment === true || /success/i.test(r.j?.output?.message || ''))) {
      return { ok: true, errore: null }
    }
    return { ok: false, errore: erroreFedex(r.j, r.status) }
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : String(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACKING — POST /track/v1/trackingnumbers. Usa le chiavi Track del contratto se presenti, altrimenti
// le Ship. Torna scanEvents (data/descrizione/luogo) + lo stato sintetico (latestStatusDetail): il cron
// mappa con mapStatoFedex + prioritaStato, e `consegnata` dal codice 'DL'.
// ─────────────────────────────────────────────────────────────────────────────
export async function trackingFedex(
  cred: CredenzialiFedex, trackingNumber: string, test?: boolean, timeoutMs = 20000
): Promise<{ stati: string[]; eventi: { data: string; descrizione: string; luogo: string }[]; consegnata: boolean; raw: string }> {
  const tn = String(trackingNumber || '').trim()
  const key = cred.track_api_key || cred.api_key
  const secret = cred.track_api_secret || cred.api_secret
  if (!tn || !key || !secret) return { stati: [], eventi: [], consegnata: false, raw: '' }
  let token: string
  try { token = await getToken(key, secret, test) }
  catch { return { stati: [], eventi: [], consegnata: false, raw: '' } }
  try {
    const r = await chiamaFedex(token, '/track/v1/trackingnumbers', {
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber: tn } }],
    }, 'POST', test, timeoutMs)
    const trackResults = r.j?.output?.completeTrackResults?.[0]?.trackResults
    const tr = Array.isArray(trackResults) ? trackResults[0] : null
    if (!tr) return { stati: [], eventi: [], consegnata: false, raw: (r.txt || '').substring(0, 2000) }
    const eventiRaw: any[] = Array.isArray(tr.scanEvents) ? tr.scanEvents : []
    const eventi = eventiRaw.map((e: any) => {
      const loc = e?.scanLocation || {}
      const luogo = [loc.city, loc.stateOrProvinceCode].filter(Boolean).join(' ').trim()
      return {
        data: String(e?.date || '').trim(),
        descrizione: String(e?.eventDescription || '').replace(/\s+/g, ' ').trim(),
        luogo,
      }
    }).filter((e) => e.descrizione)
    const stati = eventi.map((e) => e.descrizione)
    const latest = tr?.latestStatusDetail
    const codice = String(latest?.code || latest?.derivedCode || '').toUpperCase()
    const descLatest = String(latest?.description || latest?.statusByLocale || '').trim()
    if (descLatest) stati.push(descLatest)
    const consegnata = codice === 'DL' || /delivered|consegnat/i.test(descLatest)
    return { stati, eventi, consegnata, raw: (r.txt || '').substring(0, 2000) }
  } catch {
    return { stati: [], eventi: [], consegnata: false, raw: '' }
  }
}

// Mappa uno stato del tracking FedEx allo stato interno (sullo stampo di mapStatoBrt/mapStatoGls, con la
// REGOLA RESO condivisa). Gestisce sia i testi (anche in inglese, come li dà FedEx) sia i codici FedEx
// più comuni (DL/OD/IT/PU/DE/RS…) che possono arrivare come "code" dal latestStatusDetail.
export function mapStatoFedex(testo: string): string | null {
  const x = (testo || '').toLowerCase().trim()
  if (!x) return null
  if (testoIndicaReso(x)) return 'reso_mittente'
  // Codici FedEx secchi (2 lettere) — quando arriva il code invece della descrizione.
  if (x === 'dl') return 'consegnata'
  if (x === 'od') return 'in_consegna'
  if (x === 'rs') return 'reso_mittente'
  if (x === 'de' || x === 'se') return 'non_consegnato'
  if (x === 'it' || x === 'ar' || x === 'dp' || x === 'ip') return 'in_transito'
  if (x === 'pu' || x === 'oc' || x === 'pd') return 'spedita'
  if (x === 'hl') return 'in_giacenza'
  // Testi (IT/EN).
  if (/return to (shipper|sender)|reso al mittente|restituit/.test(x)) return 'reso_mittente'
  if (/consegnat|delivered/.test(x)) return 'consegnata'
  if (/giacenz|hold at location|held|available for pickup|disponibile per il ritiro/.test(x)) return 'in_giacenza'
  if (/out for delivery|in consegna|in distribuzione|on (the )?fedex vehicle/.test(x)) return 'in_consegna'
  if (/delivery exception|attempted|tentativo|destinatario assente|indirizzo err|rifiut|customer not available|refused/.test(x)) return 'non_consegnato'
  if (/in transit|in transito|departed|arrived|at (local|destination) fedex|at fedex|smistament|hub|in viaggio|on the way/.test(x)) return 'in_transito'
  if (/picked up|ritiro effettuat|presa in carico|shipment information sent|label created|shipment created|spedit|creata|accettat/.test(x)) return 'spedita'
  return null
}

// Chiusura distinta per FedEx DIRETTO: FedEx auto-conferma la spedizione alla create e il ritiro è
// programmato a parte sul conto (pickupType) — NON esiste un borderò/manifest da trasmettere come GLS o
// una conferma esplicita come BRT. La distinta è quindi solo un documento: si attesta subito (come SDA),
// senza chiamare FedEx. Guardia tipo==='fedex': non tocca gli altri corrieri.
export async function chiudiDistintaFedex(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta || !distinta.corriere_id) return { skip: true }
    if (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE')) return { skip: true }
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: corriere } = await createAdminSupabase()
      .from('corrieri').select('id, tipo').eq('id', distinta.corriere_id).maybeSingle()
    if (!corriere || corriere.tipo !== 'fedex') return { skip: true }
    await supabase.from('distinte').update({
      bordero_id: 'N/A', confermata_vettore: true, data_conferma: new Date().toISOString(),
    }).eq('id', distintaId)
    return { ok: true }
  } catch (e: any) {
    return { errore: String(e?.message || e) }
  }
}
