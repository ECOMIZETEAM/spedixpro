import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey } from '@/lib/api-auth'
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { registraMovimento } from '@/lib/movimenti'
import { verificaCreditoCatena, addebitaCatena } from '@/lib/cascata'
import {
  spediamoproGetQuotation, spediamoproCreateShipment, spediamoproGetLabel,
  spediamoproWaitForTracking, kgToGrams, cmToMm, euroToCents, centsToEuro,
} from '@/lib/spediamopro'

// API pubblica MoovExpress — crea una spedizione sul contratto della API key.
// Auth: Authorization: Bearer <api_key>
// Body: { packages:[{weight,length,width,height}], shipFrom:{...}, shipTo:{...}, codValue?, insuranceValue?, notes?, contenuto? }
export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()

  if (!body.shipTo?.state?.toString().trim() && (body.shipTo?.country || 'IT') === 'IT')
    return NextResponse.json({ error: 'Provincia destinatario obbligatoria (shipTo.state)' }, { status: 400 })
  if (!body.shipTo?.postalCode) return NextResponse.json({ error: 'CAP destinatario obbligatorio (shipTo.postalCode)' }, { status: 400 })
  if (!body.shipFrom?.name || !body.shipFrom?.postalCode) return NextResponse.json({ error: 'Mittente incompleto (shipFrom)' }, { status: 400 })

  const { data: cliente } = await admin.from('clienti')
    .select('master_id,ragione_sociale,listino_cliente_id,tipo_contratto,credito').eq('id', ctx.clienteId).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ error: 'Cliente senza listino' }, { status: 400 })
  const masterId = cliente.master_id

  const { data: corriere } = await admin.from('corrieri')
    .select('id,tipo,credenziali,nome_contratto,attivo,master_id,settings,multicollo').eq('id', ctx.corriereId).single()
  if (!corriere) return NextResponse.json({ error: 'Contratto non trovato' }, { status: 400 })
  if (corriere.attivo === false) return NextResponse.json({ error: 'Contratto in pausa' }, { status: 400 })
  const cred = corriere.credenziali as Record<string, string>

  const packages = Array.isArray(body.packages) && body.packages.length ? body.packages : [{ weight: 1, length: 20, width: 15, height: 10 }]
  if (packages.length > 1 && (corriere as any).multicollo === false)
    return NextResponse.json({ error: 'Il contratto non prevede il multicollo' }, { status: 400 })
  const pkg = packages[0]
  const pesoReale = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1

  // Prezzo a carico del cliente (listino cliente, contratto della key)
  const ris = await calcolaPrezzoListino(admin, {
    listinoId: cliente.listino_cliente_id,
    provincia: (body.shipTo.state || '').toUpperCase().trim(),
    cap: (body.shipTo.postalCode || '').toString().trim(),
    paese: (body.shipTo.country || 'IT').toUpperCase().trim(),
    packages, corriereId: ctx.corriereId,
  })
  if (!ris) return NextResponse.json({ error: 'Nessuna tariffa disponibile per questa destinazione/peso' }, { status: 400 })

  // Supplementi contrassegno/assicurazione dal listino cliente (stessa logica del portale)
  const supp = await calcolaSupplementiCliente(admin, {
    listinoId: cliente.listino_cliente_id, corriereId: ctx.corriereId,
    contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
    valoreMerce: Number(body.valoreMerce || 0), nolo: ris.prezzo,
  })
  if (!supp.disponibile) return NextResponse.json({ error: 'Importo contrassegno/assicurazione oltre il massimo consentito per questo contratto' }, { status: 400 })
  const costoCliente = Math.round((ris.prezzo + supp.contrassegno + supp.assicurazione) * 100) / 100

  // Blocco credito (clienti a scalare)
  if (cliente.tipo_contratto === 'credito_scalare' && costoCliente > 0 && Number(cliente.credito || 0) < costoCliente) {
    return NextResponse.json({ error: `Credito insufficiente: disponibili € ${Number(cliente.credito||0).toFixed(2)}, spedizione € ${costoCliente.toFixed(2)}` }, { status: 402 })
  }
  // Verifica credito della catena master
  const catena = await verificaCreditoCatena(admin, {
    masterDirettoId: masterId, corriereOwnerId: corriere.master_id,
    provincia: body.shipTo.state, packages, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT',
  })
  if (!catena.ok) return NextResponse.json({ error: catena.errore }, { status: 402 })

  let numero = '', costoCorrente = 0, etichettaUrl: string | null = null, raw: any = null

  if (corriere.tipo === 'spedisci') {
    const baseUrl = `https://${cred.master_domain}/api/v2`
    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages, shipFrom: body.shipFrom, shipTo: body.shipTo, notes: body.notes || '', insuranceValue: body.insuranceValue || 0, codValue: body.codValue || 0, accessoriServices: [] }),
    })
    const rates = await ratesRes.json()
    if (!Array.isArray(rates) || !rates.length) return NextResponse.json({ error: 'Nessuna tariffa dal corriere' }, { status: 400 })
    const rate = rates[0]
    const res = await fetch(`${baseUrl}/shipping/create`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrierCode: rate.carrierCode, contractCode: rate.contractCode, label_format: 'PDF', packages, shipFrom: body.shipFrom, shipTo: body.shipTo, notes: body.notes || '', insuranceValue: body.insuranceValue || 0, codValue: body.codValue || 0, accessoriServices: [] }),
    })
    const text = await res.text(); try { raw = JSON.parse(text) } catch { raw = { error: text } }
    if (!res.ok || raw.error) return NextResponse.json({ error: raw?.error || text }, { status: 400 })
    numero = raw.trackingNumber; costoCorrente = parseFloat(raw.shipmentCost) || 0
    etichettaUrl = raw.labelData ? `data:application/pdf;base64,${raw.labelData}` : (Array.isArray(raw.labels) && raw.labels[0]?.labelData ? `data:application/pdf;base64,${raw.labels[0].labelData}` : null)
  } else if (corriere.tipo === 'spediamopro') {
    const sender = { name: body.shipFrom.name?.substring(0,35), address: body.shipFrom.street1?.substring(0,35), postalCode: body.shipFrom.postalCode, city: body.shipFrom.city?.substring(0,35), province: body.shipFrom.state?.substring(0,2).toUpperCase(), country: 'IT', phone: body.shipFrom.phone || undefined, email: body.shipFrom.email?.substring(0,50) || undefined }
    const consignee: any = { name: body.shipTo.name?.substring(0,35), address: body.shipTo.street1?.substring(0,35), postalCode: body.shipTo.postalCode, city: body.shipTo.city?.substring(0,35), province: body.shipTo.state?.substring(0,2).toUpperCase(), country: (body.shipTo.country||'IT').toUpperCase() }
    if (body.shipTo.phone) consignee.phone = body.shipTo.phone
    if (body.shipTo.email) consignee.email = body.shipTo.email.substring(0,50)
    const parcels = [{ weight: kgToGrams(pesoReale), length: cmToMm(pkg?.length||10), width: cmToMm(pkg?.width||10), height: cmToMm(pkg?.height||10) }]
    const cod = body.codValue ? euroToCents(body.codValue) : undefined
    const ins = body.insuranceValue ? euroToCents(body.insuranceValue) : undefined
    const quotation = await spediamoproGetQuotation(cred.authcode, cred.service_id || null, { parcels, sender, consignee, cashOnDeliveryAmount: cod, insuredAmount: ins })
    const shipment = await spediamoproCreateShipment(cred.authcode, { parcels, sender, consignee, quotation, cashOnDeliveryAmount: cod, insuredAmount: ins, externalReference: body.notes || undefined })
    let trk = shipment.trackingCode; if (!trk) trk = await spediamoproWaitForTracking(cred.authcode, shipment.id)
    numero = trk || shipment.code || `SP-${shipment.id}`; costoCorrente = centsToEuro(shipment.totalPrice)
    try { const lb = await spediamoproGetLabel(cred.authcode, shipment.id); etichettaUrl = `data:application/pdf;base64,${lb.toString('base64')}` } catch {}
    raw = { ...shipment, _quotation: quotation }
  } else {
    return NextResponse.json({ error: `Tipo contratto non supportato: ${corriere.tipo}` }, { status: 400 })
  }

  const { data: inserted, error: insErr } = await admin.from('spedizioni').insert({
    master_id: masterId, cliente_id: ctx.clienteId, corriere_id: corriere.id, numero,
    mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
    mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
    mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
    dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
    dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
    dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
    colli: packages.length, peso_reale: pesoReale, lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
    contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
    tracking_number: numero, etichetta_url: etichettaUrl, raw_response: raw, stato: 'in_lavorazione',
    costo_spedizione: costoCorrente, costo_totale: costoCliente, note: body.notes || null, contenuto: body.contenuto || null,
    canale: 'api',
  }).select('id').single()
  if (insErr) return NextResponse.json({ error: `Spedizione creata sul corriere (${numero}) ma errore DB: ${insErr.message}`, tracking: numero }, { status: 500 })

  // Addebito credito cliente + cascata master
  try {
    if (costoCliente > 0) await registraMovimento(admin, { masterId, clienteId: ctx.clienteId, tipo: 'spedizione', descrizione: `${numero} - ${body.shipTo?.name||''}`.trim(), riferimento: numero, importo: -Math.abs(costoCliente), spedizioneId: inserted?.id || null, createdBy: null })
  } catch (e) { console.error('API mov cliente:', e) }
  try {
    await addebitaCatena(admin, { masterDirettoId: masterId, corriereOwnerId: corriere.master_id, costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', numero, destNome: body.shipTo?.name || '', spedizioneId: inserted?.id || null, createdBy: null })
  } catch (e) { console.error('API cascata:', e) }

  return NextResponse.json({
    id: inserted?.id || null, tracking: numero, contratto: corriere.nome_contratto,
    prezzo: costoCliente, valuta: 'EUR', label_url: `/api/v1/shipments/${inserted?.id}/label`, stato: 'in_lavorazione',
  })
}
