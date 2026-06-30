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

  // Trova il corriere spedisci.online del master
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

  const packagesDetails = [{
    weight: String(body.pesoTotale || 1),
    length: body.lunghezza || undefined,
    width: body.larghezza || undefined,
    height: body.altezza || undefined,
    description: body.contenuto || undefined,
  }]

  const payload: any = {
    contractCode: body.contractCode || cred.codice_contratto || '',
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
  try { r = JSON.parse(text) } catch { r = { error: text } }

  if (!res.ok || r.error) {
    return NextResponse.json({ error: r?.error || text }, { status: 400 })
  }

  const { data: nuovoRitiro, error: insertError } = await supabase.from('ritiri').insert({
    master_id: masterId,
    cliente_id: clienteId,
    corriere_id: corriere.id,
    pickup_id: r.pickupId || null,
    contract_code: payload.contractCode,
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
