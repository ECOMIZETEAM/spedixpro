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
  trackingCode: string
  trackingUrl: string
  totalPrice: number
  code: string
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

  return {
    id: json.data.id,
    trackingCode: json.data.trackingCode,
    trackingUrl: json.data.trackingUrl,
    totalPrice: json.data.totalPrice,
    code: json.data.code,
  }
}

export async function spediamoproGetLabel(authcode: string, shipmentId: number): Promise<Buffer> {
  const token = await getSpediamoproToken(authcode)
  const res = await fetch(`${BASE_URL}/shipments/${shipmentId}/labels`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('SpediamoPro label download failed')
  return Buffer.from(await res.arrayBuffer())
}
