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

  if (serviceId) body.services = [parseInt(serviceId)]

  const res = await fetch(`${BASE_URL}/quotations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || 'SpediamoPro quotations failed')
  }

  const quotes: SpediamoproQuotation[] = json.data
  if (!quotes?.length) throw new Error('Nessuna tariffa SpediamoPro disponibile per questo servizio')

  if (serviceId) {
    const exact = quotes.find(q => q.service === parseInt(serviceId))
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
      parcels: params.parcels.map(p => ({ type: 0, weight: p.weight, length: p.length, width: p.width, height: p.height })),
      sender: params.sender,
      consignee: params.consignee,
      quotation: {
        service: params.quotation.service,
        expectedDeliveryDate: params.quotation.expectedDeliveryDate,
        firstAvailablePickupDate: params.quotation.firstAvailablePickupDate,
        priceBreakdown: params.quotation.priceBreakdown,
      },
      labelFormat: 0,
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
  return { id: d.id, code: d.code, status: d.status, raw: json }
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
    if (d?.code) return d.code
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  return null
}
