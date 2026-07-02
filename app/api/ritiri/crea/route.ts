import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

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
    .from('spedizioni').select('id,raw_response,corriere_id,colli,peso_reale')
    .in('id', spedizioneIds).eq('master_id', masterId)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })

  const primaSped = spedizioni[0]
  const raw = primaSped.raw_response as any
  const contractCode = raw?._contractCode
  const carrierCode = raw?._carrierCode
  const shipmentId = raw?.shipmentId

  if (!carrierCode) return NextResponse.json({ error: 'Impossibile recuperare il corriere dalla spedizione.' }, { status: 400 })

  const { data: corriere } = await supabase.from('corrieri').select('id,credenziali').eq('id', primaSped.corriere_id).single()
  if (!corriere) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 400 })

  const cred = corriere.credenziali as Record<string, string>
  const baseUrl = `https://${cred.master_domain}/api/v2`

  if (!body.mittNome || !body.mittIndirizzo || !body.mittCitta || !body.mittCap) {
    return NextResponse.json({ error: 'Dati mittente incompleti' }, { status: 400 })
  }
  if (!body.dataRitiro) return NextResponse.json({ error: 'Data ritiro obbligatoria' }, { status: 400 })

  const colliTotali = spedizioni.reduce((sum, s) => sum + (s.colli || 1), 0)
  const pesoTotale = spedizioni.reduce((sum, s) => sum + (parseFloat(String(s.peso_reale)) || 1), 0)
  const pickupTime = normalizzaOrario(body.orarioRitiro)

  const shipFrom = {
    name: body.mittNome, street1: body.mittIndirizzo, city: body.mittCitta,
    state: body.mittProvincia || undefined, postalCode: body.mittCap, country: body.mittPaese || 'IT',
    phone: body.mittTelefono || undefined, email: body.mittEmail || undefined,
  }
  const base: any = {
    pickupDate: body.dataRitiro, shipFrom, packagesDetails: [{ weight: String(pesoTotale || 1) }],
  }
  if (pickupTime) base.pickupTime = pickupTime
  if (body.istruzioni) base.specialInstruction = body.istruzioni

  // ── Provo più varianti di payload finché una non risponde 200 ──
  const varianti: { nome: string; payload: any }[] = [
    { nome: 'A_solo_shipmentId', payload: { ...base, shipmentId } },
    { nome: 'B_carrierCode_come_contract', payload: { ...base, contractCode: carrierCode, carrierCode, shipmentId } },
    { nome: 'C_blob_cifrato', payload: { ...base, contractCode, carrierCode, shipmentId } },
    { nome: 'D_blob_senza_carrier', payload: { ...base, contractCode, shipmentId } },
    { nome: 'E_blob_senza_shipment', payload: { ...base, contractCode, carrierCode } },
  ]

  let ok: any = null
  let usata = ''
  const esiti: string[] = []

  for (const v of varianti) {
    try {
      const res = await fetch(`${baseUrl}/pickup/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(v.payload),
      })
      const text = await res.text()
      const snippet = text.substring(0, 200).replace(/\s+/g, ' ')
      console.log(`[RITIRO][${v.nome}] status ${res.status} body: ${snippet}`)
      esiti.push(`${v.nome}=${res.status}`)
      if (res.ok) {
        let r: any
        try { r = JSON.parse(text) } catch { r = {} }
        if (r && !r.error) { ok = r; usata = v.nome; break }
      }
    } catch (e: any) {
      console.log(`[RITIRO][${v.nome}] EXCEPTION ${e?.message}`)
      esiti.push(`${v.nome}=EXC`)
    }
  }

  if (!ok) {
    return NextResponse.json({ error: `Nessuna variante accettata dal corriere. Esiti: ${esiti.join(', ')}` }, { status: 400 })
  }

  console.log(`[RITIRO] VARIANTE VINCENTE: ${usata} pickupId: ${ok.pickupId}`)

  const { data: nuovoRitiro, error: insertError } = await supabase.from('ritiri').insert({
    master_id: masterId, cliente_id: clienteId, corriere_id: corriere.id,
    pickup_id: ok.pickupId || null, contract_code: contractCode || carrierCode,
    mitt_nome: body.mittNome, mitt_indirizzo: body.mittIndirizzo, mitt_citta: body.mittCitta,
    mitt_provincia: body.mittProvincia || null, mitt_cap: body.mittCap, mitt_paese: body.mittPaese || 'IT',
    mitt_telefono: body.mittTelefono || null, mitt_email: body.mittEmail || null,
    colli: colliTotali, peso_totale: pesoTotale, contenuto: body.contenuto || null,
    data_ritiro: body.dataRitiro, orario_ritiro: pickupTime || body.orarioRitiro || null,
    istruzioni: body.istruzioni || null, stato: 'richiesto',
    raw_response: { ...ok, _spedizioni: spedizioneIds, _variante: usata },
  }).select().single()

  if (insertError) {
    return NextResponse.json({ error: `Ritiro creato (${ok.pickupId}) ma errore DB: ${insertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ id: nuovoRitiro.id, pickupId: ok.pickupId, variante: usata })
}
