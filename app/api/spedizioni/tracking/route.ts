import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { spediamoproGetTracking } from '@/lib/spediamopro'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const { data: spedizione } = await supabase.from('spedizioni')
    .select('tracking_number,corriere_id,numero,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_telefono,dest_email,raw_response,colli_dettaglio,mitt_nome,cliente_id,contenuto')
    .eq('id', spedizioneId).eq('master_id', utente?.master_id).single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', spedizione.cliente_id).single()
  const { data: corriere } = await supabase.from('corrieri').select('credenziali,tipo,nome_contratto').eq('id', spedizione.corriere_id).single()
  if (!corriere) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 404 })

  const cred = corriere.credenziali as Record<string,string>
  const base = {
    numero: spedizione.numero,
    tracking_number: spedizione.tracking_number,
    corriere: corriere.nome_contratto,
    cliente: cliente?.ragione_sociale || null,
    contenuto: spedizione.contenuto,
    mitt_nome: spedizione.mitt_nome,
    destinatario: {
      nome: spedizione.dest_nome,
      indirizzo: spedizione.dest_indirizzo,
      citta: spedizione.dest_citta,
      provincia: spedizione.dest_provincia,
      telefono: spedizione.dest_telefono,
      email: spedizione.dest_email,
    },
    colli_dettaglio: spedizione.colli_dettaglio || [],
  }

  try {
    // SpediamoPro: usa authcode + shipmentId (non master_domain). Eventi: {at, title, description}.
    if (corriere.tipo === 'spediamopro') {
      const raw: any = spedizione.raw_response || {}
      const spid = raw.id || raw?.raw?.data?.id
      const authcode = cred?.authcode
      if (!spid || !authcode) return NextResponse.json({ ...base, eventi: [], error: 'Tracking non disponibile per questa spedizione' })
      const tr = await spediamoproGetTracking(authcode, Number(spid))
      const eventi = (tr.events || []).map((e: any) => ({
        date: e.at || e.date || '',
        description: [e.title, e.description].filter(Boolean).join(' — ') || 'Evento',
        location: '',
      })).reverse()   // più recente in alto
      return NextResponse.json({ ...base, eventi, status_code: 200, raw: tr })
    }

    // Spedisci.online: endpoint per master_domain con Bearer.
    const res = await fetch(`https://${cred.master_domain}/api/v2/shipping/tracking/${spedizione.tracking_number}`, {
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' }
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = { raw_text: text } }

    return NextResponse.json({
      ...base,
      eventi: data.events || data.tracking || data.trackingEvents || (Array.isArray(data) ? data : []),
      status_code: res.status,
      raw: data
    })
  } catch(e: any) {
    return NextResponse.json({ ...base, eventi: [], error: e.message, tracking_number: spedizione.tracking_number }, { status: 200 })
  }
}