import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const body = await req.json()
  const masterId = utente.master_id
  const clienteId = utente.ruolo === 'cliente' ? utente.cliente_id : (body.clienteId || null)

  const { data: corriere } = await supabase
    .from('corrieri').select('id,credenziali').eq('master_id', masterId).eq('tipo', 'spedisci').single()

  if (!corriere) return NextResponse.json({ error: 'Nessun corriere spedisci.online configurato' }, { status: 400 })

  const cred = corriere.credenziali as Record<string, string>
  const baseUrl = `https://${cred.master_domain}/api/v2`

  if (!body.mittNome || !body.mittIndirizzo || !body.mittCitta || !body.mittCap) {
    return NextResponse.json({ error: 'Dati mittente incompleti' }, { status: 400 })
  }
  if (!body.dataRitiro) {
    return NextResponse.json({ error: 'Data ritiro obbligatoria' }, { status: 400 })
  }

  // *** FIX: recupera un contractCode VALIDO chiamando prima /shipping/rates ***
  // Il campo "codice_contratto" salvato nel DB è cifrato e non utilizzabile direttamente.
  const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packages: [{
        length: body.lunghezza || 20, width: body.larghezza || 15, height: body.altezza || 10,
        weight: body.pesoTotale || 1,
      }],
      shipFrom: {
        name: body.mittNome, company: body.mittNome, street1: body.mittIndirizzo,
        city: body.mittCitta, state: body.mittProvincia || '', postalCode: body.mittCap,
        country: 'IT', phone: body.mittTelefono || null, email: body.mittEmail || null,
      },
      shipTo: {
        name: body.mittNome, company: '', street1: body.mittIndirizzo,
        city: body.mittCitta, state: body.mittProvincia || '', postalCode: body.mittCap,
        country: 'IT', phone: null, email: null,
      },
      notes: '', insuranceValue: 0, codValue: 0, accessoriServices: [],
    }),
  })

  const rates = await ratesRes.json()
  if (!Array.isArray(rates) || !rates.length) {
    return NextResponse.json({ error: 'Impossibile recuperare un contratto valido per il ritiro' }, { status: 400 })
  }

  const contractCode = body.contractCode || rates[0].contractCode
  const carrierCode = rates[0].carrierCode

  const packagesDetails = [{
    weight: String(body.pesoTotale || 1),
    length: body.lunghezza || undefined,
    width: body.larghezza || undefined,
    height: body.altezza || undefined,
    description: body.contenuto || undefined,
  }]

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
    packagesDetails,
  }

  const res = await fetch(`${baseUrl}/pickup/create`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let r: any
  try { r = JSON.parse(text) } catch { r = { error: text.substring(0, 300) } }

  if (!res.ok || r.error) {
    return NextResponse.json({ error: r?.error || text.substring(0, 300) }, { status: 400 })
  }

  const { data: nuovoRitiro, error: insertError } = await supabase.from('ritiri').insert({
    master_id: masterId,
    cliente_id: clienteId,
    corriere_id: corriere.id,
    pickup_id: r.pickupId || null,
    contract_code: contractCode,
    mitt_nome: body.mittNome,
    mitt_indirizzo: body.mittIndirizzo,
    mitt_citta: body.mittCitta,
    mitt_provincia: body.mittProvincia || null,
    mitt_cap: body.mittCap,
    mitt_paese: body.mittPaese || 'IT',
    mitt_telefono: body.mittTelefono || null,
    mitt_email: body.mittEmail || null,
    colli: body.colli || 1,
    peso_totale: body.pesoTotale || null,
    lunghezza: body.lunghezza || null,
    larghezza: body.larghezza || null,
    altezza: body.altezza || null,
    contenuto: body.contenuto || null,
    data_ritiro: body.dataRitiro,
    orario_ritiro: body.orarioRitiro || null,
    istruzioni: body.istruzioni || null,
    stato: 'richiesto',
    raw_response: r,
  }).select().single()

  if (insertError) {
    return NextResponse.json({ error: `Ritiro creato (${r.pickupId}) ma errore DB: ${insertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ id: nuovoRitiro.id, pickupId: r.pickupId })
}
