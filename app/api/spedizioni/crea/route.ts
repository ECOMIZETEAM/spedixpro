import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import {
  spediamoproGetQuotation,
  spediamoproCreateShipment,
  spediamoproGetLabel,
  kgToGrams, cmToMm, euroToCents, centsToEuro
} from '@/lib/spediamopro'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const body = await req.json()

  const clienteId = utente?.ruolo === 'cliente' ? utente.cliente_id : body.clienteId
  const { data: cliente } = await supabase.from('clienti').select('master_id,ragione_sociale,listino_cliente_id').eq('id', clienteId).single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  const masterId = cliente.master_id

  // ─── Trova corriere reale da usare ────────────────────────────────────────
  let corriereRecord: any = null

  if (cliente.listino_cliente_id) {
    const { data: fascia } = await supabase
      .from('listini_clienti_fasce')
      .select('corrieri(id,tipo,credenziali,nome_contratto)')
      .eq('listino_id', cliente.listino_cliente_id)
      .limit(1)
      .single()
    corriereRecord = (fascia as any)?.corrieri
  }

  if (!corriereRecord) {
    const { data: c } = await supabase
      .from('corrieri').select('id,tipo,credenziali,nome_contratto')
      .eq('master_id', masterId).eq('tipo', 'spedisci')
      .limit(1)
      .single()
    corriereRecord = c
  }

  if (!corriereRecord) return NextResponse.json({ error: 'Nessun corriere configurato' }, { status: 400 })

  const cred = corriereRecord.credenziali as Record<string, string>

  if (!body.shipTo?.state?.trim()) return NextResponse.json({ error: 'Provincia destinatario obbligatoria' }, { status: 400 })
  if (!body.shipFrom?.state?.trim()) return NextResponse.json({ error: 'Provincia mittente obbligatoria' }, { status: 400 })

  const packages = body.packages || [{ length: 20, width: 15, height: 10, weight: 1 }]
  const pkg = packages[0]
  const pesoReale = parseFloat(pkg?.weight || 1)

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEDISCI.ONLINE
  // ═══════════════════════════════════════════════════════════════════════════
  if (corriereRecord.tipo === 'spedisci') {
    const baseUrl = `https://${cred.master_domain}/api/v2`

    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packages, shipFrom: body.shipFrom, shipTo: body.shipTo,
        notes: body.notes || '', insuranceValue: body.insuranceValue || 0,
        codValue: body.codValue || 0, accessoriServices: []
      }),
    })
    const rates = await ratesRes.json()
    if (!Array.isArray(rates) || !rates.length) return NextResponse.json({ error: 'Nessuna tariffa dal corriere' }, { status: 400 })
    const rate = rates[0]

    const res = await fetch(`${baseUrl}/shipping/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrierCode: rate.carrierCode, contractCode: rate.contractCode,
        label_format: 'PDF', packages,
        shipFrom: body.shipFrom, shipTo: body.shipTo,
        notes: body.notes || '', insuranceValue: body.insuranceValue || 0,
        codValue: body.codValue || 0, accessoriServices: []
      }),
    })

    const text = await res.text()
    let r: any
    try { r = JSON.parse(text) } catch { r = { error: text } }
    if (!res.ok || r.error) return NextResponse.json({ error: r?.error || text }, { status: 400 })

    const numero = r.trackingNumber
    const costoCliente = parseFloat(body.totalPrice) || parseFloat(r.shipmentCost) || 0
    const costoCorrente = parseFloat(r.shipmentCost) || 0

    let etichetteUrls: string[] = []
    if (Array.isArray(r.labels) && r.labels.length) {
      etichetteUrls = r.labels.map((l: any) => l.labelData ? `data:application/pdf;base64,${l.labelData}` : (l.url || '')).filter(Boolean)
    } else if (r.labelData) {
      etichetteUrls = packages.map(() => `data:application/pdf;base64,${r.labelData}`)
    }

    const colliDettaglio = (body.colliDettaglio || packages.map((p: any) => ({
      lunghezza: p.length, larghezza: p.width, altezza: p.height
    }))).map((c: any, i: number) => ({
      numero: i + 1,
      lunghezza: c.lunghezza || packages[i]?.length || null,
      larghezza: c.larghezza || packages[i]?.width || null,
      altezza: c.altezza || packages[i]?.height || null,
      peso: packages[i]?.weight || null,
      etichetta_url: etichetteUrls[i] || etichetteUrls[0] || null,
    }))

    const { error: insertError } = await supabase.from('spedizioni').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id, numero,
      mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
      mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
      mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
      dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
      dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
      dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
      colli: packages.length, peso_reale: packages[0]?.weight || null,
      lunghezza: packages[0]?.length || null, larghezza: packages[0]?.width || null, altezza: packages[0]?.height || null,
      contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
      tracking_number: r.trackingNumber || null,
      etichetta_url: etichetteUrls[0] || (r.labelData ? `data:application/pdf;base64,${r.labelData}` : null),
      colli_dettaglio: colliDettaglio, raw_response: r, stato: 'in_lavorazione',
      costo_spedizione: costoCorrente, costo_totale: costoCliente,
      note: body.notes || null, contenuto: body.contenuto || null,
    })

    if (insertError) {
      return NextResponse.json({ error: `Spedizione creata su corriere (${numero}) ma errore DB: ${insertError.message}`, numero }, { status: 500 })
    }

    return NextResponse.json({ numero, tracking: r.trackingNumber, costo: r.shipmentCost })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEDIAMOPRO
  // ═══════════════════════════════════════════════════════════════════════════
  if (corriereRecord.tipo === 'spediamopro') {
    try {
      const sender = {
        name: body.shipFrom.name?.substring(0, 35),
        address: body.shipFrom.street1?.substring(0, 35),
        postalCode: body.shipFrom.postalCode,
        city: body.shipFrom.city?.substring(0, 35),
        province: body.shipFrom.state?.substring(0, 2).toUpperCase(),
        country: 'IT',
        phone: body.shipFrom.phone || undefined,
        email: body.shipFrom.email?.substring(0, 50) || undefined,
      }
      const consignee = {
        name: body.shipTo.name?.substring(0, 35),
        address: body.shipTo.street1?.substring(0, 35),
        postalCode: body.shipTo.postalCode,
        city: body.shipTo.city?.substring(0, 35),
        province: body.shipTo.state?.substring(0, 2).toUpperCase(),
        country: (body.shipTo.country || 'IT').toUpperCase(),
        phone: body.shipTo.phone || undefined,
        email: body.shipTo.email?.substring(0, 50) || undefined,
      }
      const parcels = [{
        weight: kgToGrams(pesoReale),
        length: cmToMm(pkg?.length || 10), width: cmToMm(pkg?.width || 10), height: cmToMm(pkg?.height || 10),
      }]
      const cashOnDeliveryAmount = body.codValue ? euroToCents(body.codValue) : undefined
      const insuredAmount = body.insuranceValue ? euroToCents(body.insuranceValue) : undefined
      const serviceId = cred.service_id || null

      const quotation = await spediamoproGetQuotation(cred.authcode, serviceId, {
        parcels, sender, consignee, cashOnDeliveryAmount, insuredAmount
      })

      const shipment = await spediamoproCreateShipment(cred.authcode, {
        parcels, sender, consignee, quotation, cashOnDeliveryAmount, insuredAmount,
        externalReference: body.notes || undefined,
      })

      let etichettaUrl: string | null = null
      try {
        const labelBuffer = await spediamoproGetLabel(cred.authcode, shipment.id)
        etichettaUrl = `data:application/pdf;base64,${labelBuffer.toString('base64')}`
      } catch (labelErr) {
        console.error('SpediamoPro label error:', labelErr)
      }

      const costoCorrente = centsToEuro(shipment.totalPrice)
      const costoCliente = parseFloat(body.totalPrice) || costoCorrente

      const { error: insertError } = await supabase.from('spedizioni').insert({
        master_id: masterId, cliente_id: clienteId, corriere_id: corriereRecord.id,
        numero: shipment.trackingCode,
        mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_citta: body.shipFrom.city,
        mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
        mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
        dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_citta: body.shipTo.city,
        dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
        dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
        colli: packages.length, peso_reale: pesoReale,
        lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
        contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
        tracking_number: shipment.trackingCode,
        etichetta_url: etichettaUrl,
        raw_response: { ...shipment, _quotation: quotation },
        stato: 'in_lavorazione',
        costo_spedizione: costoCorrente, costo_totale: costoCliente,
        note: body.notes || null, contenuto: body.contenuto || null,
      })

      if (insertError) {
        return NextResponse.json({ error: `Spedizione creata su SpediamoPro (${shipment.trackingCode}) ma errore DB: ${insertError.message}`, numero: shipment.trackingCode }, { status: 500 })
      }

      return NextResponse.json({
        numero: shipment.trackingCode, tracking: shipment.trackingCode, costo: costoCorrente.toFixed(2),
      })
    } catch (err: any) {
      console.error('SpediamoPro error:', err)
      return NextResponse.json({ error: err.message || 'Errore SpediamoPro' }, { status: 400 })
    }
  }

  return NextResponse.json({ error: `Tipo corriere non supportato: ${corriereRecord.tipo}` }, { status: 400 })
}
