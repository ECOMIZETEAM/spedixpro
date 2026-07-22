import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey } from '@/lib/api-auth'
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { registraMovimento } from '@/lib/movimenti'
import { verificaCreditoCatena, addebitaCatena } from '@/lib/cascata'
import { inviaWebhook } from '@/lib/webhooks'
import { EMAIL_PER_CORRIERE,
  spediamoproGetQuotation, spediamoproCreateShipment, spediamoproGetLabel,
  spediamoproWaitForTracking, kgToGrams, cmToMm, euroToCents, centsToEuro,
  normalizzaEtichetta, telValidoSp,
} from '@/lib/spediamopro'

// GET /api/v1/shipments — elenca le spedizioni del cliente della API key (paginata).
// Molti client "testano il collegamento" con una GET qui: senza questa si otteneva 405.
export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const admin = createAdminSupabase()
  const url = new URL(req.url)
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50') || 50))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0') || 0)
  const stato = url.searchParams.get('stato')
  let q = admin.from('spedizioni')
    .select('id,numero,tracking_number,stato,dest_nome,dest_citta,dest_provincia,dest_cap,dest_paese,colli,peso_reale,contrassegno,costo_totale,created_at', { count: 'exact' })
    .eq('cliente_id', ctx.clienteId).order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (stato) q = q.eq('stato', stato)
  const { data, count } = await q
  return NextResponse.json({ shipments: data || [], count: count || 0, limit, offset })
}

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

  // "Presso" (c/o): seconda riga dell'indirizzo. Accetto `presso` e, come alias, `street2`
  // (così chi arriva da altre piattaforme non deve cambiare payload). Su Spedisci finisce in
  // street2; su SpediamoPro non esiste un campo dedicato -> viene accodato all'indirizzo.
  const pressoFrom = String(body.shipFrom?.presso || body.shipFrom?.street2 || '').trim()
  const pressoTo = String(body.shipTo?.presso || body.shipTo?.street2 || '').trim()
  const conPresso = (via: string, presso: string) => (presso ? `${via} c/o ${presso}`.trim() : via)

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
    corriereNome: corriere.nome_contratto,
  })
  if (!catena.ok) return NextResponse.json({ error: 'Credito insufficiente' }, { status: 402 })

  let numero = '', costoCorrente = 0, etichettaUrl: string | null = null, raw: any = null

  if (corriere.tipo === 'spedisci') {
    const baseUrl = `https://${cred.master_domain}/api/v2`
    // Spedisci ha la seconda riga indirizzo nativa: ci mappiamo il "presso".
    const spedFrom = { ...body.shipFrom, street2: pressoFrom }
    const spedTo = { ...body.shipTo, street2: pressoTo }
    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages, shipFrom: { ...spedFrom, email: EMAIL_PER_CORRIERE }, shipTo: { ...spedTo, email: EMAIL_PER_CORRIERE }, notes: body.notes || '', insuranceValue: body.insuranceValue || 0, codValue: body.codValue || 0, accessoriServices: [] }),
    })
    const rates = await ratesRes.json()
    if (!Array.isArray(rates) || !rates.length) return NextResponse.json({ error: 'Nessuna tariffa dal corriere' }, { status: 400 })
    // Sceglie la tariffa del CONTRATTO di questo corriere (non la prima): sullo stesso account
    // a valle possono coesistere più corrieri (GLS, Poste...) -> evita etichette col vettore sbagliato.
    const rate = cred.codice_contratto
      ? rates.find((r: any) => r.contractCode === cred.codice_contratto)
      : rates[0]
    if (!rate) return NextResponse.json({ error: 'Contratto non disponibile per questo corriere' }, { status: 400 })
    const res = await fetch(`${baseUrl}/shipping/create`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrierCode: rate.carrierCode, contractCode: rate.contractCode, label_format: 'PDF', packages, shipFrom: spedFrom, shipTo: spedTo, notes: body.notes || '', insuranceValue: body.insuranceValue || 0, codValue: body.codValue || 0, accessoriServices: [] }),
    })
    const text = await res.text(); try { raw = JSON.parse(text) } catch { raw = { error: text } }
    if (!res.ok || raw.error) return NextResponse.json({ error: raw?.error || text }, { status: 400 })
    numero = raw.trackingNumber; costoCorrente = parseFloat(raw.shipmentCost) || 0
    etichettaUrl = raw.labelData ? `data:application/pdf;base64,${raw.labelData}` : (Array.isArray(raw.labels) && raw.labels[0]?.labelData ? `data:application/pdf;base64,${raw.labels[0].labelData}` : null)
    // Salvo carrier/contract usati: servono al RITIRO (pickup/create li rilegge da raw_response). Senza, la spedizione non è ritirabile.
    raw = { ...raw, _carrierCode: rate.carrierCode, _contractCode: rate.contractCode }
  } else if (corriere.tipo === 'spediamopro') {
    // Telefono destinatario obbligatorio per SpediamoPro (serve alla consegna): errore chiaro invece
    // del tecnico "consignee.phone should be of type string".
    if (!telValidoSp(body.shipTo?.phone)) {
      return NextResponse.json({ error: 'Telefono destinatario obbligatorio e non valido (solo cifre, 6–15): il corriere lo richiede per la consegna.' }, { status: 400 })
    }
    // SpediamoPro non ha la seconda riga indirizzo: il "presso" viene accodato all'indirizzo
    // (max 35 caratteri imposti dal corriere).
    const sender = { name: body.shipFrom.name?.substring(0,35), address: conPresso(body.shipFrom.street1 || '', pressoFrom).substring(0,35), postalCode: body.shipFrom.postalCode, city: body.shipFrom.city?.substring(0,35), province: body.shipFrom.state?.substring(0,2).toUpperCase(), country: 'IT', phone: body.shipFrom.phone || undefined, email: body.shipFrom.email?.substring(0,50) || undefined }
    const consignee: any = { name: body.shipTo.name?.substring(0,35), address: conPresso(body.shipTo.street1 || '', pressoTo).substring(0,35), postalCode: body.shipTo.postalCode, city: body.shipTo.city?.substring(0,35), province: body.shipTo.state?.substring(0,2).toUpperCase(), country: (body.shipTo.country||'IT').toUpperCase() }
    if (body.shipTo.phone) consignee.phone = body.shipTo.phone
    if (body.shipTo.email) consignee.email = body.shipTo.email.substring(0,50)
    // MULTICOLLO: un parcel per OGNI collo (prima si inviava un solo parcel col peso totale).
    const parcels = packages.map((p: any) => ({ weight: kgToGrams(parseFloat(p?.weight)||1), length: cmToMm(p?.length||10), width: cmToMm(p?.width||10), height: cmToMm(p?.height||10) }))
    const cod = body.codValue ? euroToCents(body.codValue) : undefined
    const ins = body.insuranceValue ? euroToCents(body.insuranceValue) : undefined
    // BRT ha due service BRTEXP: quale sia disponibile dipende da peso/misure e colli. Se il
    // contratto ne ha un secondo, li passo SEMPRE entrambi e SpediamoPro sceglie il tier giusto.
    const serviceIdV1 = cred.service_id_multicollo
      ? [cred.service_id, cred.service_id_multicollo].filter(Boolean).join(',')
      : (cred.service_id || null)
    const quotation = await spediamoproGetQuotation(cred.authcode, serviceIdV1, { parcels, sender, consignee, cashOnDeliveryAmount: cod, insuredAmount: ins })
    const externalRefV1 = (body.notes ? String(body.notes) : '').substring(0, 64) || undefined
    const shipment = await spediamoproCreateShipment(cred.authcode, { parcels, sender, consignee, quotation, cashOnDeliveryAmount: cod, insuredAmount: ins, externalReference: externalRefV1 })
    let trk = shipment.trackingCode; if (!trk) trk = await spediamoproWaitForTracking(cred.authcode, shipment.id)
    numero = trk || shipment.code || `SP-${shipment.id}`; costoCorrente = centsToEuro(shipment.totalPrice)
    // ZIP multicollo → PDF unico; PDF/immagini mono-collo invariati. Se non pronta, resta null (riscaricata on-demand).
    try { const lb = await spediamoproGetLabel(cred.authcode, shipment.id); const norm = await normalizzaEtichetta(lb); etichettaUrl = `data:${norm.mime};base64,${norm.buffer.toString('base64')}` } catch {}
    raw = { ...shipment, _quotation: quotation }
  } else {
    return NextResponse.json({ error: `Tipo contratto non supportato: ${corriere.tipo}` }, { status: 400 })
  }

  const { data: inserted, error: insErr } = await admin.from('spedizioni').insert({
    master_id: masterId, cliente_id: ctx.clienteId, corriere_id: corriere.id, numero,
    mitt_nome: body.shipFrom.name, mitt_indirizzo: body.shipFrom.street1, mitt_presso: pressoFrom || null, mitt_citta: body.shipFrom.city,
    mitt_provincia: body.shipFrom.state, mitt_cap: body.shipFrom.postalCode, mitt_paese: 'IT',
    mitt_email: body.shipFrom.email || null, mitt_telefono: body.shipFrom.phone || null,
    dest_nome: body.shipTo.name, dest_indirizzo: body.shipTo.street1, dest_presso: pressoTo || null, dest_citta: body.shipTo.city,
    dest_provincia: body.shipTo.state, dest_cap: body.shipTo.postalCode, dest_paese: body.shipTo.country || 'IT',
    dest_email: body.shipTo.email || null, dest_telefono: body.shipTo.phone || null,
    colli: packages.length, peso_reale: pesoReale,
    peso_volume: ris?.peso_volume || null, peso_fatturato: ris?.peso_fatturato || null,
    lunghezza: pkg?.length || null, larghezza: pkg?.width || null, altezza: pkg?.height || null,
    contrassegno: body.codValue || 0, assicurazione: body.insuranceValue || 0,
    tracking_number: numero, etichetta_url: etichettaUrl, raw_response: raw, stato: 'in_lavorazione',
    costo_spedizione: costoCorrente, costo_totale: costoCliente, note: body.notes || null, contenuto: body.contenuto || null,
    canale: 'api',
  }).select('id').single()
  if (insErr) return NextResponse.json({ error: `Spedizione creata sul corriere (${numero}) ma errore DB: ${insErr.message}`, tracking: numero }, { status: 500 })

  // EMAIL BRAND MoovExpress a mittente e destinatario (in background, best-effort):
  // al provider e' andata solo l'email schermo; ai clienti finali scriviamo noi.
  after(async () => {
    try {
      const { inviaEmailSpedizioneCreata } = await import('@/lib/email')
      let notificaDest = true
      if (ctx.clienteId) {
        const { data: cli } = await admin.from('clienti').select('impostazioni').eq('id', ctx.clienteId).maybeSingle()
        notificaDest = (cli?.impostazioni as any)?.notifica_email_dest !== false
      }
      await inviaEmailSpedizioneCreata({
        mittEmail: body.shipFrom?.email, destEmail: body.shipTo?.email,
        mittNome: body.shipFrom?.name, destNome: body.shipTo?.name, destCitta: body.shipTo?.city,
        numero, corriere: corriere.nome_contratto, notificaDest,
      })
    } catch { /* best-effort */ }
  })

  // Addebito credito cliente + cascata master
  try {
    if (costoCliente > 0) await registraMovimento(admin, { masterId, clienteId: ctx.clienteId, tipo: 'spedizione', descrizione: `${numero} - ${body.shipTo?.name||''}`.trim(), riferimento: numero, importo: -Math.abs(costoCliente), spedizioneId: inserted?.id || null, createdBy: null })
  } catch (e) { console.error('API mov cliente:', e) }
  try {
    await addebitaCatena(admin, { masterDirettoId: masterId, corriereOwnerId: corriere.master_id, costoSpedizione: costoCorrente, provincia: body.shipTo.state, packages, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', corriereNome: corriere.nome_contratto, contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0), numero, destNome: body.shipTo?.name || '', spedizioneId: inserted?.id || null, createdBy: null })
  } catch (e) { console.error('API cascata:', e) }

  // Notifica ai webhook del cliente (best-effort: non blocca né fa fallire la creazione)
  inviaWebhook({
    clienteId: ctx.clienteId, corriereId: corriere.id, evento: 'shipment.created',
    data: {
      tracking_number: numero, carrier: corriere.nome_contratto, status: 'in_lavorazione',
      location: body.shipTo?.city || '', events: [],
    },
  }).catch(() => {})

  return NextResponse.json({
    id: inserted?.id || null, tracking: numero, contratto: corriere.nome_contratto,
    prezzo: costoCliente, valuta: 'EUR', label_url: `/api/v1/shipments/${inserted?.id}/label`, stato: 'in_lavorazione',
  })
}
