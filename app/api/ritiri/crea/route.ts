import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { spediamoproCreatePickup } from '@/lib/spediamopro'

function normalizzaOrario(v: any): string | null {
  if (!v) return null
  const s = String(v).trim().toLowerCase()
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m) {
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
    const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  if (s.includes('matt')) return '09:00'
  if (s.includes('pome')) return '14:00'
  if (s.includes('sera')) return '17:00'
  return null
}

// Fascia oraria (from/to) richiesta da SpediamoPro
function fasciaOraria(v: any): { from: string; to: string } {
  const s = String(v || '').trim().toLowerCase()
  if (s.includes('matt')) return { from: '09:00', to: '13:00' }
  if (s.includes('pome')) return { from: '14:00', to: '18:00' }
  if (s.includes('sera')) return { from: '17:00', to: '19:00' }
  const hhmm = normalizzaOrario(v)
  if (hhmm) {
    const h = parseInt(hhmm.split(':')[0], 10)
    const toH = Math.min(23, h + 3)
    return { from: hhmm, to: `${String(toH).padStart(2, '0')}:00` }
  }
  return { from: '09:00', to: '18:00' }
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 }) }

  const masterId = utente.master_id
  const clienteId = utente.ruolo === 'cliente' ? utente.cliente_id : (body.clienteId || null)

  const spedizioneIds = body.spedizioneIds as string[]
  if (!spedizioneIds?.length) return NextResponse.json({ error: 'Seleziona almeno una spedizione da ritirare' }, { status: 400 })

  const { data: spedizioni } = await supabase
    .from('spedizioni')
    .select('id,raw_response,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email')
    .in('id', spedizioneIds).eq('master_id', masterId)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })

  const primaSped = spedizioni[0]
  const raw = primaSped.raw_response as any

  const { data: corriere } = await supabase.from('corrieri').select('id,tipo,credenziali').eq('id', primaSped.corriere_id).single()
  if (!corriere) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 400 })

  const cred = corriere.credenziali as Record<string, string>

  if (!body.mittNome || !body.mittIndirizzo || !body.mittCitta || !body.mittCap) {
    return NextResponse.json({ error: 'Dati mittente incompleti' }, { status: 400 })
  }
  if (!body.dataRitiro) return NextResponse.json({ error: 'Data ritiro obbligatoria' }, { status: 400 })

  const colliTotali = spedizioni.reduce((sum, s) => sum + (s.colli || 1), 0)
  const pesoTotale = spedizioni.reduce((sum, s) => sum + (parseFloat(String(s.peso_reale)) || 1), 0)

  // Funzione comune di salvataggio su DB
  async function salvaRitiro(pickupCode: string) {
    return await supabase.from('ritiri').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriere!.id,
      tracking_ritiro: pickupCode || null, cod_ritiro: pickupCode || null,
      mitt_nome: body.mittNome, mitt_indirizzo: body.mittIndirizzo, mitt_citta: body.mittCitta,
      mitt_provincia: body.mittProvincia || null, mitt_cap: body.mittCap,
      mitt_telefono: body.mittTelefono || null,
      colli: colliTotali, peso: pesoTotale, contenuto: body.contenuto || null,
      data_ritiro: body.dataRitiro, stato: 'richiesto',
    }).select().single()
  }

  // ══════════════════════════════════════════════════════
  // RAMO SPEDIAMOPRO
  // ══════════════════════════════════════════════════════
  if (corriere.tipo === 'spediamopro') {
    // Raccolgo gli shipmentId SpediamoPro (campo raw_response.id) delle spedizioni selezionate
    const shipmentIds: number[] = []
    let courierCode = 'sda'
    for (const s of spedizioni) {
      const r = s.raw_response as any
      const sid = r?.id || r?.raw?.data?.id
      if (sid) shipmentIds.push(Number(sid))
      const cc = r?.raw?.data?.courierService?.courier
      if (cc) courierCode = cc
    }
    if (!shipmentIds.length) {
      return NextResponse.json({ error: 'Impossibile recuperare gli ID spedizione SpediamoPro.' }, { status: 400 })
    }

    const fascia = fasciaOraria(body.orarioRitiro)
    console.log('[RITIRO][SPEDIAMOPRO] shipments:', JSON.stringify(shipmentIds), 'courier:', courierCode, 'fascia:', JSON.stringify(fascia))

    try {
      const pk = await spediamoproCreatePickup(cred.authcode, {
        contactInfo: {
          name: body.mittNome,
          address: body.mittIndirizzo,
          postalCode: body.mittCap,
          city: body.mittCitta,
          country: body.mittPaese || 'IT',
          phone: body.mittTelefono || undefined,
          email: body.mittEmail || undefined,
          province: body.mittProvincia || undefined,
        },
        date: body.dataRitiro,
        from: fascia.from,
        to: fascia.to,
        shipments: shipmentIds,
        courier: courierCode,
      })
      console.log('[RITIRO][SPEDIAMOPRO] pickup creato:', pk.code, 'id:', pk.id)

      const { data: nuovoRitiro, error: insErr } = await salvaRitiro(pk.code || String(pk.id))
      if (insErr) {
        return NextResponse.json({ error: `Ritiro creato (${pk.code}) ma errore DB: ${insErr.message}` }, { status: 500 })
      }
      return NextResponse.json({ id: nuovoRitiro.id, pickupId: pk.code || pk.id })
    } catch (e: any) {
      console.log('[RITIRO][SPEDIAMOPRO] errore:', e?.message)
      return NextResponse.json({ error: e?.message || 'Errore creazione ritiro SpediamoPro' }, { status: 400 })
    }
  }

  // ══════════════════════════════════════════════════════
  // RAMO SPEDISCI.ONLINE (flusso esistente)
  // ══════════════════════════════════════════════════════
  const carrierCode = raw?._carrierCode
  const shipmentId = raw?.shipmentId
  if (!carrierCode) return NextResponse.json({ error: 'Impossibile recuperare il corriere dalla spedizione.' }, { status: 400 })

  const baseUrl = `https://${cred.master_domain}/api/v2`
  const pickupTime = normalizzaOrario(body.orarioRitiro)

  const shipFrom = {
    name: body.mittNome, company: body.mittNome, street1: body.mittIndirizzo, street2: '',
    city: body.mittCitta, state: body.mittProvincia || '', postalCode: body.mittCap,
    country: body.mittPaese || 'IT', phone: body.mittTelefono || null, email: body.mittEmail || 'noreply@spedixpro.it',
  }

  let contractCode: string | null = null
  try {
    const ratesBody = {
      packages: [{ length: primaSped.lunghezza || 20, width: primaSped.larghezza || 15, height: primaSped.altezza || 10, weight: pesoTotale || 1 }],
      shipFrom,
      shipTo: {
        name: primaSped.dest_nome || 'Destinatario', company: '', street1: primaSped.dest_indirizzo || '', street2: '',
        city: primaSped.dest_citta || '', state: primaSped.dest_provincia || '', postalCode: primaSped.dest_cap || '',
        country: primaSped.dest_paese || 'IT', phone: null, email: primaSped.dest_email || 'noreply@spedixpro.it',
      },
      notes: 'pickup', insuranceValue: 0, codValue: 0, accessoriServices: [],
    }
    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(ratesBody),
    })
    const rates = await ratesRes.json()
    if (Array.isArray(rates) && rates.length) {
      const match = rates.find((r: any) => r.carrierCode === carrierCode) || rates[0]
      contractCode = match?.contractCode || null
    }
  } catch (e: any) {
    console.log('[RITIRO] Errore rates:', e?.message)
  }

  if (!contractCode) {
    return NextResponse.json({ error: 'Impossibile recuperare il codice contratto valido per il ritiro.' }, { status: 400 })
  }

  const payload: any = {
    contractCode, carrierCode, pickupDate: body.dataRitiro, shipFrom,
    packagesDetails: [{ weight: String(pesoTotale || 1) }],
  }
  if (pickupTime) payload.pickupTime = pickupTime
  if (body.istruzioni) payload.specialInstruction = body.istruzioni
  if (shipmentId) payload.shipmentId = shipmentId

  console.log('[RITIRO] Payload pickup/create:', JSON.stringify(payload))
  const res = await fetch(`${baseUrl}/pickup/create`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  console.log('[RITIRO] Risposta pickup/create status:', res.status, 'body:', text.substring(0, 500))

  let r: any
  try { r = JSON.parse(text) } catch { r = { error: text.substring(0, 300) } }
  if (!res.ok || r.error) {
    return NextResponse.json({ error: r?.error || `Errore ${res.status}` }, { status: 400 })
  }

  const { data: nuovoRitiro, error: insertError } = await salvaRitiro(r.pickupId)
  if (insertError) {
    return NextResponse.json({ error: `Ritiro creato (${r.pickupId}) ma errore DB: ${insertError.message}` }, { status: 500 })
  }
  return NextResponse.json({ id: nuovoRitiro.id, pickupId: r.pickupId })
}
