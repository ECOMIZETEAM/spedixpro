import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  let body: any
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 })
  }

  console.log('[RITIRO] Body ricevuto:', JSON.stringify(body))

  const masterId = utente.master_id
  const clienteId = utente.ruolo === 'cliente' ? utente.cliente_id : (body.clienteId || null)

  const spedizioneIds = body.spedizioneIds as string[]
  console.log('[RITIRO] spedizioneIds:', JSON.stringify(spedizioneIds))

  if (!spedizioneIds?.length) {
    return NextResponse.json({ error: 'Seleziona almeno una spedizione da ritirare' }, { status: 400 })
  }

  const { data: spedizioni, error: sError } = await supabase
    .from('spedizioni')
    .select('id,raw_response,corriere_id,colli,peso_reale')
    .in('id', spedizioneIds)
    .eq('master_id', masterId)

  console.log('[RITIRO] Spedizioni trovate:', spedizioni?.length, 'errore:', sError?.message)

  if (!spedizioni?.length) {
    return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })
  }

  const primaSped = spedizioni[0]
  const raw = primaSped.raw_response as any
  const contractCode = raw?._contractCode
  const carrierCode = raw?._carrierCode
  const shipmentId = raw?.shipmentId

  console.log('[RITIRO] contractCode presente:', !!contractCode, 'carrierCode:', carrierCode, 'shipmentId:', shipmentId)

  if (!carrierCode) {
    return NextResponse.json({ error: 'Impossibile recuperare il corriere dalla spedizione.' }, { status: 400 })
  }

  const { data: corriere } = await supabase
    .from('corrieri').select('id,credenziali').eq('id', primaSped.corriere_id).single()

  if (!corriere) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 400 })

  const cred = corriere.credenziali as Record<string, string>
  const baseUrl = `https://${cred.master_domain}/api/v2`

  if (!body.mittNome || !body.mittIndirizzo || !body.mittCitta || !body.mittCap) {
    return NextResponse.json({ error: 'Dati mittente incompleti' }, { status: 400 })
  }
  if (!body.dataRitiro) {
    return NextResponse.json({ error: 'Data ritiro obbligatoria' }, { status: 400 })
  }

  const colliTotali = spedizioni.reduce((sum, s) => sum + (s.colli || 1), 0)
  const pesoTotale = spedizioni.reduce((sum, s) => sum + (parseFloat(String(s.peso_reale)) || 1), 0)

  const payload: any = {
    contractCode,
    carrierCode,
    pickupDate: body.dataRitiro,
    pickupTime: body.orarioRitiro || undefined,
    specialInstruction: body.istruzioni || undefined,
    shipFrom: {
      name: body.mittNome,
      street1: body.mittIndirizzo,
      city: body.mittCitta,
      state: body.mittProvincia || undefined,
      postalCode: body.mittCap,
      country: body.mittPaese || 'IT',
      phone: body.mittTelefono || undefined,
      email: body.mittEmail || undefined,
    },
    packagesDetails: [{ weight: String(pesoTotale || 1) }],
  }

  if (shipmentId) payload.shipmentId = shipmentId

  console.log('[RITIRO] Payload pickup/create:', JSON.stringify(payload))

  const res = await fetch(`${baseUrl}/pickup/create`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  console.log('[RITIRO] Risposta pickup/create status:', res.status, 'body:', text.substring(0, 1000))

  let r: any
  try { r = JSON.parse(text) } catch { r = { error: text.substring(0, 300) } }

  if (!res.ok || r.error) {
    return NextResponse.json({ error: r?.error || `Errore ${res.status}` }, { status: 400 })
  }

  const { data: nuovoRitiro, error: insertError } = await supabase.from('ritiri').insert({
    master_id: masterId,
    cliente_id: clienteId,
    corriere_id: corriere.id,
    pickup_id: r.pickupId || null,
    contract_code: contractCode || carrierCode,
    mitt_nome: body.mittNome,
    mitt_indirizzo: body.mittIndirizzo,
    mitt_citta: body.mittCitta,
    mitt_provincia: body.mittProvincia || null,
    mitt_cap: body.mittCap,
    mitt_paese: body.mittPaese || 'IT',
    mitt_telefono: body.mittTelefono || null,
    mitt_email: body.mittEmail || null,
    colli: colliTotali,
    peso_totale: pesoTotale,
    contenuto: body.contenuto || null,
    data_ritiro: body.dataRitiro,
    orario_ritiro: body.orarioRitiro || null,
    istruzioni: body.istruzioni || null,
    stato: 'richiesto',
    raw_response: { ...r, _spedizioni: spedizioneIds },
  }).select().single()

  if (insertError) {
    return NextResponse.json({ error: `Ritiro creato (${r.pickupId}) ma errore DB: ${insertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ id: nuovoRitiro.id, pickupId: r.pickupId })
}
