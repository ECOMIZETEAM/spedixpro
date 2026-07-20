import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproCreatePickup, spediamoproWaitPickupCode } from '@/lib/spediamopro'
import { erroreRitiroPulito } from '@/lib/errore-corriere'

// API pubblica MoovExpress — richiede un ritiro per spedizioni del contratto della API key.
// Auth: Authorization: Bearer <api_key>
// Body: { shipmentIds:[uuid], date:'YYYY-MM-DD', timeFrom?, timeTo?, from:{name,street1,city,state,postalCode,phone?,email?}, notes? }
export const maxDuration = 30
export const dynamic = 'force-dynamic'

function pulisciTelefono(v: any): string | undefined {
  if (!v) return undefined
  const d = String(v).replace(/[^0-9]/g, '')
  return d || undefined
}
function fasciaOraria(from: any, to: any): { from: string; to: string } {
  const hhmm = (v: any) => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? `${String(Math.min(23, +m[1])).padStart(2, '0')}:${m[2]}` : null }
  const f = hhmm(from), t = hhmm(to)
  if (f && t) return { from: f, to: t }
  if (f) { const h = Math.min(23, parseInt(f) + 3); return { from: f, to: `${String(h).padStart(2, '0')}:00` } }
  return { from: '09:00', to: '18:00' }
}

export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()

  const shipmentIds = body.shipmentIds
  if (!Array.isArray(shipmentIds) || !shipmentIds.length) return NextResponse.json({ error: 'shipmentIds obbligatorio' }, { status: 400 })
  if (!body.date) return NextResponse.json({ error: 'date obbligatoria (YYYY-MM-DD)' }, { status: 400 })
  const from = body.from || {}
  if (!from.name || !from.street1 || !from.city || !from.postalCode) return NextResponse.json({ error: 'Mittente (from) incompleto: name, street1, city, postalCode' }, { status: 400 })

  // Solo spedizioni del cliente e del contratto della key
  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,raw_response,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email')
    .in('id', shipmentIds).eq('cliente_id', ctx.clienteId).eq('corriere_id', ctx.corriereId)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })

  const { data: corriere } = await admin.from('corrieri').select('id,tipo,credenziali').eq('id', ctx.corriereId).single()
  if (!corriere) return NextResponse.json({ error: 'Contratto non trovato' }, { status: 400 })
  const cred = corriere.credenziali as Record<string, string>

  const colliTotali = spedizioni.reduce((s: number, x: any) => s + (x.colli || 1), 0)
  const pesoTotale = spedizioni.reduce((s: number, x: any) => s + (parseFloat(String(x.peso_reale)) || 1), 0)
  const fascia = fasciaOraria(body.timeFrom, body.timeTo)

  async function salvaRitiro(pickupCode: string) {
    return await admin.from('ritiri').insert({
      master_id: ctx!.masterId, cliente_id: ctx!.clienteId, corriere_id: corriere!.id,
      tracking_ritiro: pickupCode || null, cod_ritiro: pickupCode || null,
      mitt_nome: from.name, mitt_indirizzo: from.street1, mitt_citta: from.city,
      mitt_provincia: from.state || null, mitt_cap: from.postalCode, mitt_telefono: pulisciTelefono(from.phone) || null,
      colli: colliTotali, peso: pesoTotale, contenuto: body.notes || null,
      data_ritiro: body.date, stato: 'richiesto',
    }).select('id').single()
  }

  // ── SPEDIAMOPRO ──
  if (corriere.tipo === 'spediamopro') {
    const shipmentApiIds: number[] = []
    let courierCode = 'sda'
    for (const s of spedizioni) {
      const r = s.raw_response as any
      const sid = r?.id || r?.raw?.data?.id
      if (sid) shipmentApiIds.push(Number(sid))
      const cc = r?.raw?.data?.courierService?.courier
      if (cc) courierCode = cc
    }
    if (!shipmentApiIds.length) return NextResponse.json({ error: 'Impossibile recuperare gli ID spedizione' }, { status: 400 })
    try {
      const pk = await spediamoproCreatePickup(cred.authcode, {
        contactInfo: {
          name: from.name, address: from.street1, postalCode: from.postalCode, city: from.city,
          country: from.country || 'IT', phone: pulisciTelefono(from.phone), email: from.email || undefined,
          province: from.state || undefined,
        },
        date: body.date, from: fascia.from, to: fascia.to, shipments: shipmentApiIds, courier: courierCode,
      })
      let code: string | null = pk.code || null
      if (!code && pk.id) code = await spediamoproWaitPickupCode(cred.authcode, pk.id)
      const { data: nuovo, error } = await salvaRitiro(code || String(pk.id))
      if (error) return NextResponse.json({ error: `Ritiro creato (${pk.code}) ma errore DB: ${error.message}` }, { status: 500 })
      return NextResponse.json({ id: nuovo.id, pickupId: code || pk.id, stato: 'richiesto', date: body.date })
    } catch (e: any) {
      return NextResponse.json({ error: erroreRitiroPulito(e) }, { status: 400 })
    }
  }

  // ── SPEDISCI ──
  const primaSped: any = spedizioni[0]
  const raw = primaSped.raw_response as any
  const carrierCode = raw?._carrierCode
  // Per il ritiro spedisci.online serve la LDV/tracking come "shipmentId": con l'id numerico il ramo
  // Poste si appende (timeout). Fallback all'id numerico solo se la LDV manca del tutto. (Come flusso principale.)
  const shipmentId = raw?.trackingNumber || primaSped.tracking_number || primaSped.numero || raw?.shipmentId
  if (!carrierCode) return NextResponse.json({ error: 'Impossibile recuperare il corriere dalla spedizione' }, { status: 400 })
  const baseUrl = `https://${cred.master_domain}/api/v2`
  const shipFrom = {
    name: from.name, company: from.name, street1: from.street1, street2: '', city: from.city,
    state: from.state || '', postalCode: from.postalCode, country: from.country || 'IT',
    phone: pulisciTelefono(from.phone) || null, email: from.email || 'noreply@moovexpress.com',
  }

  let contractCode: string | null = null
  try {
    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packages: [{ length: primaSped.lunghezza || 20, width: primaSped.larghezza || 15, height: primaSped.altezza || 10, weight: pesoTotale || 1 }],
        shipFrom,
        shipTo: { name: primaSped.dest_nome || 'Destinatario', company: '', street1: primaSped.dest_indirizzo || '', street2: '', city: primaSped.dest_citta || '', state: primaSped.dest_provincia || '', postalCode: primaSped.dest_cap || '', country: primaSped.dest_paese || 'IT', phone: null, email: primaSped.dest_email || 'noreply@moovexpress.com' },
        notes: 'pickup', insuranceValue: 0, codValue: 0, accessoriServices: [],
      }),
    })
    const rates = await ratesRes.json()
    if (Array.isArray(rates) && rates.length) contractCode = ((cred.codice_contratto && rates.find((r: any) => r.contractCode === cred.codice_contratto)) || rates.find((r: any) => r.carrierCode === carrierCode) || rates[0])?.contractCode || null
  } catch (e: any) { console.error('API pickup rates:', e?.message) }
  if (!contractCode) return NextResponse.json({ error: 'Impossibile recuperare il codice contratto per il ritiro' }, { status: 400 })

  const payload: any = { contractCode, carrierCode, pickupDate: body.date, shipFrom, packagesDetails: [{ weight: String(pesoTotale || 1) }] }
  if (fascia.from) payload.pickupTime = fascia.from
  if (body.notes) payload.specialInstruction = body.notes
  if (shipmentId) payload.shipmentId = shipmentId

  // Timeout: l'API del corriere a volte si appende (Poste). Senza limite → 504. Con AbortController → errore pulito.
  const ctrl = new AbortController()
  const toId = setTimeout(() => ctrl.abort(), 25000)
  let res: Response
  try {
    res = await fetch(`${baseUrl}/pickup/create`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal,
    })
  } catch {
    clearTimeout(toId)
    return NextResponse.json({ error: 'Il corriere non ha risposto in tempo per il ritiro. Riprova; se persiste, quel contratto va gestito dal portale del corriere (es. Poste).' }, { status: 504 })
  }
  clearTimeout(toId)
  const text = await res.text()
  let r: any; try { r = JSON.parse(text) } catch { r = { error: text.substring(0, 300) } }
  if (!res.ok || r.error) return NextResponse.json({ error: r?.error || `Errore ${res.status}` }, { status: 400 })

  // Codice ritiro del corriere: spedisci può restituirlo come pickupId (CP…) o, in alcune versioni,
  // come id/uuid/code/reference. Prendo il primo disponibile così salviamo sempre il riferimento giusto.
  const codiceCorriere = r.pickupId ?? r.pickup_id ?? r.id ?? r.uuid ?? r.code ?? r.reference ?? null
  const { data: nuovo, error } = await salvaRitiro(codiceCorriere)
  if (error) return NextResponse.json({ error: `Ritiro creato (${codiceCorriere}) ma errore DB: ${error.message}` }, { status: 500 })
  // NB: `id` = riferimento interno MoovExpress (UUID). `codice_ritiro`/`pickupId` = codice del CORRIERE (es. CP…).
  return NextResponse.json({ id: nuovo.id, codice_ritiro: codiceCorriere, pickupId: codiceCorriere, stato: 'richiesto', date: body.date })
}
