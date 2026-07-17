/**
 * SpediamoPro API v2 client
 * Auth: OAuth2 Client Credentials (Authcode as Basic username, empty password)
 * Units: weight in grams, dimensions in mm, prices in euro cents
 */

const BASE_URL = 'https://core.spediamopro.com/api/v2'

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function getSpediamoproToken(authcode: string): Promise<string> {
  const now = Date.now()
  const cached = tokenCache.get(authcode)
  if (cached && now < cached.expiresAt) return cached.token

  const res = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${authcode}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`SpediamoPro auth failed: ${err}`)
  }

  const data = await res.json()
  tokenCache.set(authcode, {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 300) * 1000,
  })
  return data.access_token
}

export function kgToGrams(kg: number): number { return Math.round(kg * 1000) }
export function cmToMm(cm: number): number { return Math.round(cm * 10) }
export function euroToCents(euro: number): number { return Math.round(euro * 100) }
export function centsToEuro(cents: number): number { return cents / 100 }

export interface SpediamoproAddress {
  name: string
  address: string
  postalCode: string
  city: string
  province: string
  country: string
  phone?: string
  email?: string
}

export interface SpediamoproParcel {
  weight: number
  length: number
  width: number
  height: number
  type?: number
  content?: string   // descrizione merce (stampata in etichetta); se assente SpediamoPro usa il default "campionatura generica"
}

export interface SpediamoproQuotation {
  service: number
  expectedDeliveryDate: string
  firstAvailablePickupDate: string
  priceBreakdown: Record<string, unknown>
  totalPrice?: number
  courierService?: { courier: string; description: string }
}

export async function spediamoproGetQuotation(
  authcode: string,
  serviceId: string | null,
  params: {
    parcels: SpediamoproParcel[]
    sender: SpediamoproAddress
    consignee: SpediamoproAddress
    cashOnDeliveryAmount?: number
    insuredAmount?: number
  }
): Promise<SpediamoproQuotation> {
  const token = await getSpediamoproToken(authcode)

  const body: any = {
    parcels: params.parcels.map(p => ({ type: 0, weight: p.weight, length: p.length, width: p.width, height: p.height })),
    sender: params.sender,
    consignee: params.consignee,
    cashOnDeliveryAmount: params.cashOnDeliveryAmount || null,
    insuredAmount: params.insuredAmount || null,
  }

  // serviceId può essere un singolo id ("29") o più id separati da virgola ("28,29"):
  // utile per BRT che ha due service per lo stesso contratto in base al numero di colli
  // (1-2 colli vs 3+). Passandoli entrambi, SpediamoPro torna quello applicabile.
  const wantedServices = serviceId
    ? String(serviceId).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : []
  if (wantedServices.length) body.services = wantedServices

  const res = await fetch(`${BASE_URL}/quotations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok || json.error) {
    const details = json.error?.details?.map((d: any) => `${d.source}: ${d.message}`).join(', ')
    console.error('[SPEDIAMOPRO][quotation] fallita — colli:', params.parcels.length, 'service:', serviceId, 'risposta:', JSON.stringify(json).substring(0, 600))
    throw new Error(details || json.error?.message || 'SpediamoPro quotations failed')
  }

  const quotes: SpediamoproQuotation[] = json.data
  if (!quotes?.length) {
    // Diagnostica multicollo: il filtro su un service ha dato 0. Riprovo SENZA filtro per vedere
    // quali servizi (e corrieri) SpediamoPro offre davvero per questa spedizione multi-collo.
    let disp: any[] = []
    if (serviceId) {
      try {
        const bodyNoFilter: any = { ...body }; delete bodyNoFilter.services
        const res2 = await fetch(`${BASE_URL}/quotations`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyNoFilter) })
        const j2 = await res2.json()
        disp = (j2?.data || []).map((q: any) => ({ service: q.service, corriere: q.courierService?.courier, descr: q.courierService?.description, price: q.totalPrice }))
      } catch {}
    }
    console.error('[SPEDIAMOPRO][quotation] nessuna tariffa — colli:', params.parcels.length, 'service richiesto:', serviceId, 'servizi SENZA filtro:', JSON.stringify(disp).substring(0, 700))
    throw new Error('Nessuna tariffa SpediamoPro disponibile per questo servizio')
  }

  if (wantedServices.length) {
    const exact = quotes.find(q => wantedServices.includes(q.service))
    if (exact) return exact
  }

  return quotes[0]
}

export async function spediamoproCreateShipment(
  authcode: string,
  params: {
    parcels: SpediamoproParcel[]
    sender: SpediamoproAddress
    consignee: SpediamoproAddress
    quotation: SpediamoproQuotation
    cashOnDeliveryAmount?: number
    insuredAmount?: number
    externalReference?: string
    notes?: string
  }
): Promise<{
  id: number
  trackingCode: string | null
  trackingUrl: string | null
  totalPrice: number
  code: string | null
  raw: any
}> {
  const token = await getSpediamoproToken(authcode)

  const res = await fetch(`${BASE_URL}/quotations/accept`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parcels: params.parcels.map(p => ({ type: 0, weight: p.weight, length: p.length, width: p.width, height: p.height, ...(p.content ? { content: String(p.content).substring(0, 100) } : {}) })),
      sender: params.sender,
      consignee: params.consignee,
      quotation: {
        service: params.quotation.service,
        expectedDeliveryDate: params.quotation.expectedDeliveryDate,
        firstAvailablePickupDate: params.quotation.firstAvailablePickupDate,
        priceBreakdown: params.quotation.priceBreakdown,
      },
      labelFormat: [9,19].includes(Number(params.quotation.service)) ? 1 : 0,
      cashOnDeliveryAmount: params.cashOnDeliveryAmount || null,
      insuredAmount: params.insuredAmount || null,
      externalReference: params.externalReference || null,
      consigneeNote: params.notes || null,
    }),
  })

  const json = await res.json()
  if (!res.ok || json.error) {
    const details = json.error?.details?.map((d: any) => `${d.source}: ${d.message}`).join(', ')
    throw new Error(details || json.error?.message || 'SpediamoPro create shipment failed')
  }

  const d = json.data || json

  // I nomi esatti dei campi possono variare — proviamo diverse possibilità note
  const trackingCode = d.trackingCode || d.tracking_code || d.parcels?.[0]?.tracking || null
  const trackingUrl = d.trackingUrl || d.tracking_url || null
  const totalPrice = d.totalPrice ?? d.total_price ?? params.quotation.totalPrice ?? 0

  return {
    id: d.id,
    trackingCode,
    trackingUrl,
    totalPrice,
    code: d.code || null,
    raw: json, // risposta grezza completa per debug
  }
}

export async function spediamoproGetShipment(authcode: string, shipmentId: number): Promise<any> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/shipments/${shipmentId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`SpediamoPro get shipment failed: ${errText}`)
  }
  return res.json()
}

export async function spediamoproWaitForTracking(authcode: string, shipmentId: number, maxAttempts = 10, delayMs = 2000): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const json = await spediamoproGetShipment(authcode, shipmentId)
      const d = json.data || json
      const tracking = d.trackingCode || d.parcels?.[0]?.tracking || null
      if (tracking) return tracking
    } catch (e) {
      console.error('Polling tracking error:', e)
    }
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  return null
}

export async function spediamoproGetLabel(authcode: string, shipmentId: number, maxAttempts = 5, delayMs = 2000): Promise<Buffer> {
  const token = await getSpediamoproToken(authcode)
  let lastError = ''
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${BASE_URL}/shipments/${shipmentId}/labels`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer())
    }
    lastError = await res.text()
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  throw new Error(`SpediamoPro label download failed: ${lastError}`)
}

/**
 * Normalizza il buffer etichetta restituito da SpediamoPro in un formato servibile.
 * - PDF singolo (mono-collo) → invariato (application/pdf)
 * - GIF/PNG (es. UPS) → invariato
 * - ZIP (MULTICOLLO: un PDF per collo) → i PDF vengono UNITI in un unico PDF multipagina,
 *   così il cliente scarica/stampa un solo file con tutte le etichette dei colli.
 * Non cambia nulla per il mono-collo: solo lo ZIP (prima servito erroneamente come PDF) viene gestito.
 */
export async function normalizzaEtichetta(buf: Buffer): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  const head = buf.subarray(0, 4).toString('latin1')
  // ZIP → multicollo: unisco i PDF in uno solo
  if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) {
    try {
      const JSZip = (await import('jszip')).default
      const { PDFDocument } = await import('pdf-lib')
      const zip = await JSZip.loadAsync(buf)
      const names = Object.keys(zip.files).filter(n => /\.pdf$/i.test(n) && !zip.files[n].dir).sort()
      if (names.length) {
        const merged = await PDFDocument.create()
        for (const n of names) {
          const b = await zip.files[n].async('nodebuffer')
          try {
            const src = await PDFDocument.load(b)
            const pages = await merged.copyPages(src, src.getPageIndices())
            pages.forEach(p => merged.addPage(p))
          } catch { /* salta un PDF corrotto senza far fallire tutto */ }
        }
        if (merged.getPageCount() > 0) {
          return { buffer: Buffer.from(await merged.save()), mime: 'application/pdf', ext: 'pdf' }
        }
      }
    } catch { /* se l'unione fallisce, servo lo ZIP grezzo qui sotto */ }
    return { buffer: buf, mime: 'application/zip', ext: 'zip' }
  }
  if (head.startsWith('GIF8')) return { buffer: buf, mime: 'image/gif', ext: 'gif' }
  if (head.charCodeAt(0) === 0x89 && head.substring(1, 4) === 'PNG') return { buffer: buf, mime: 'image/png', ext: 'png' }
  // default: PDF (mono-collo e caso storico)
  return { buffer: buf, mime: 'application/pdf', ext: 'pdf' }
}

// ── Pickup / Ritiro ──
export interface SpediamoproPickupContact {
  name: string
  address: string
  postalCode: string
  city: string
  country: string
  phone?: string
  email?: string
  province?: string
  at?: string
}

export async function spediamoproCreatePickup(
  authcode: string,
  params: {
    contactInfo: SpediamoproPickupContact
    date: string
    from: string
    to: string
    shipments: number[]
    courier: string
  }
): Promise<{ id: number; code: string; status: number; raw: any }> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/pickups`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contactInfo: params.contactInfo,
      date: params.date,
      from: params.from,
      to: params.to,
      shipments: params.shipments,
      courier: params.courier,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`SpediamoPro pickup failed (${res.status}): ${text.substring(0, 300)}`)
  }
  let json: any
  try { json = JSON.parse(text) } catch { json = {} }
  const d = json?.data || {}
  // Codice pickup robusto: di norma è `code` (CP…), ma prendo anche eventuali alias per non
  // ripiegare inutilmente sull'id numerico se il campo si chiama diversamente.
  const code = d.code ?? d.pickupCode ?? d.trackingCode ?? d.tracking ?? d.reference ?? null
  return { id: d.id, code, status: d.status, raw: json }
}

export async function spediamoproGetPickup(authcode: string, pickupId: number): Promise<any> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/pickups/${pickupId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) return null
  const json = await res.json()
  return json?.data || null
}

// Recupera il code (CP...) del pickup, con qualche tentativo (a volte non è immediato)
export async function spediamoproWaitPickupCode(authcode: string, pickupId: number, maxAttempts = 4, delayMs = 1500): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const d = await spediamoproGetPickup(authcode, pickupId)
    const code = d?.code ?? d?.pickupCode ?? d?.trackingCode ?? d?.tracking ?? d?.reference ?? null
    if (code) return code
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  return null
}

// Annulla una spedizione SpediamoPro. Ritorna { ok, error } — error = motivo del corriere
// (es. già spedita / chiusa in distinta) da mostrare all'utente.
export async function spediamoproCancelShipment(authcode: string, shipmentId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getSpediamoproToken(authcode)
    const res = await fetch(`${BASE_URL}/shipments/${shipmentId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (res.ok) return { ok: true }
    const text = await res.text().catch(() => '')
    let msg = ''
    try { msg = JSON.parse(text)?.error?.message || JSON.parse(text)?.message || '' } catch {}
    return { ok: false, error: msg || text.slice(0, 200) || `HTTP ${res.status}` }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// ── Tracking ──
export async function spediamoproGetTracking(authcode: string, shipmentId: number): Promise<{ status: number | null; trackingCode: string | null; events: any[]; shipmentCode: string | null }> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/shipments/${shipmentId}/tracking`, { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  if (!res.ok) throw new Error(`SpediamoPro tracking (${res.status}): ${text.slice(0, 150)}`)
  const d = (() => { try { return JSON.parse(text)?.data || {} } catch { return {} } })()
  return { status: d.status ?? null, trackingCode: d.trackingCode || null, events: d.events || [], shipmentCode: d.shipmentCode || null }
}

// ── Stock / Giacenza ──
export async function spediamoproSearchStocks(authcode: string, search: string): Promise<any[]> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/stocks/search`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ search }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SpediamoPro stocks (${res.status}): ${text.slice(0, 150)}`)
  const d = (() => { try { return JSON.parse(text) } catch { return {} } })()
  return Array.isArray(d?.data) ? d.data : (d?.data?.items || d?.items || (Array.isArray(d) ? d : []))
}

// Svincolo giacenza: releaseAction 1=riconsegna stesso indirizzo, 3=reso mittente, 4=ritira in sede, ecc.
export async function spediamoproReleaseStock(authcode: string, stockId: number, releaseAction = 1, extra: any = {}): Promise<any> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/stocks/${stockId}/release`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ releaseAction, ...extra }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SpediamoPro release (${res.status}): ${text.slice(0, 150)}`)
  try { return JSON.parse(text) } catch { return {} }
}

// ── Distinta / Bordereau ──
// Su SpediamoPro la "distinta" è il BORDEREAU: GET /shipments/bordereaux?ids[]=... che
// restituisce il PDF (o uno ZIP se più bordereaux). Non c'è un id borderò persistente:
// è un documento generato on-demand dagli shipment id. Best-effort, mai bloccante.
// Salva bordero_pdf (base64 data URI) sulla distinta.
export async function chiudiBordereauSpediamopro(supabase: any, distintaId: string): Promise<any> {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_pdf').eq('id', distintaId).maybeSingle()
    if (!distinta || distinta.bordero_pdf) return { skip: true }

    const { data: corriere } = await supabase
      .from('corrieri').select('id, tipo, credenziali').eq('id', distinta.corriere_id).maybeSingle()
    if (!corriere || corriere.tipo !== 'spediamopro') return { skip: true }
    const authcode = (corriere.credenziali || {}).authcode
    if (!authcode) return { errore: 'authcode spediamopro mancante' }

    const { data: speds } = await supabase
      .from('spedizioni').select('id, raw_response').eq('distinta_id', distintaId)

    // Shipment id interni SpediamoPro dal raw_response (come per l'annullo).
    const ids: number[] = []
    for (const s of speds || []) {
      const raw = (s.raw_response || {}) as any
      const sid = raw.id ?? raw.shipmentId ?? raw?.data?.id ?? raw?.raw?.data?.id
      if (sid != null && !isNaN(Number(sid))) ids.push(Number(sid))
    }
    const uniq = [...new Set(ids)]
    if (!uniq.length) return { errore: 'nessuno shipment id SpediamoPro nelle spedizioni' }

    const token = await getSpediamoproToken(authcode)
    let pdf: string | null = null
    let errore: string | null = null
    // L'API accetta max 30 id per richiesta.
    for (let i = 0; i < uniq.length; i += 30) {
      const batch = uniq.slice(i, i + 30)
      const qs = batch.map(id => `ids%5B%5D=${id}`).join('&')
      const r = await fetch(`${BASE_URL}/shipments/bordereaux?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) {
        errore = 'HTTP ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 150)
        continue
      }
      const ct = r.headers.get('content-type') || ''
      const buf = Buffer.from(await r.arrayBuffer())
      const mime = ct.includes('zip') ? 'application/zip' : 'application/pdf'
      if (!pdf && buf.length) pdf = `data:${mime};base64,` + buf.toString('base64')
    }

    await supabase.from('distinte').update({
      bordero_id: pdf ? 'SP' : (errore ? 'ERRORE: ' + errore : null),
      bordero_pdf: pdf,
    }).eq('id', distintaId)

    return { ok: !!pdf, errore }
  } catch (e: any) {
    try {
      await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(e?.message || e).slice(0, 150) }).eq('id', distintaId)
    } catch {}
    return { errore: String(e?.message || e) }
  }
}

// Mappa lo status SpediamoPro (0-13) allo stato interno. Lo status 11 (eccezione)
// è gestito a parte dal chiamante (controlla gli stock → giacenza / non_consegnato).
export function mapStatoSpediamopro(status: number | null): string | null {
  switch (Number(status)) {
    case 0: return 'annullata'
    case 4: case 5: case 6: case 13: return 'in_lavorazione'
    case 7: return 'spedita'
    case 8: return 'in_transito'
    case 9: return 'in_consegna'
    case 10: case 12: return 'consegnata'
    case 11: return 'eccezione'
    default: return null
  }
}
