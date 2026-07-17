import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { spediamoproGetTracking, mapStatoSpediamopro } from '@/lib/spediamopro'
import { mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const isCliente = utente.ruolo === 'cliente'
  // Master: vede il tracking di tutta la propria rete (sotto-albero). Cliente: solo le proprie.
  const masterIds = isCliente ? [utente.master_id] : await sottoAlberoMasterIds(admin, utente.master_id)

  let spedQuery = admin.from('spedizioni')
    .select('id,stato,tracking_number,corriere_id,numero,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_telefono,dest_email,raw_response,colli_dettaglio,mitt_nome,cliente_id,contenuto')
    .eq('id', spedizioneId).in('master_id', masterIds)
  if (isCliente) spedQuery = spedQuery.eq('cliente_id', utente.cliente_id)
  // Agente: solo tracking di un suo cliente.
  if (isAgente(utente as any)) spedQuery = spedQuery.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
  const { data: spedizione } = await spedQuery.single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Aggiorna lo stato salvato dallo stato live del tracking (best-effort, non blocca la risposta).
  const persistiStato = async (nuovo: string | null) => {
    if (!nuovo || nuovo === 'eccezione' || nuovo === (spedizione as any).stato) return
    if ((spedizione as any).stato === 'consegnata' || (spedizione as any).stato === 'annullata') return
    try { await admin.from('spedizioni').update({ stato: nuovo }).eq('id', spedizione.id) } catch {}
  }

  const { data: cliente } = await admin.from('clienti').select('ragione_sociale').eq('id', spedizione.cliente_id).single()
  const { data: corriere } = await admin.from('corrieri').select('credenziali,tipo,nome_contratto').eq('id', spedizione.corriere_id).single()
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
      await persistiStato(mapStatoSpediamopro(tr.status))
      const eventi = (tr.events || []).map((e: any) => ({
        date: e.at || e.date || '',
        description: [e.title, e.description].filter(Boolean).join(' — ') || 'Evento',
        location: '',
      })).reverse()   // più recente in alto
      return NextResponse.json({ ...base, eventi, status_code: 200, raw: tr })
    }

    // Spedisci.online: endpoint CORRETTO /api/v2/tracking/{tracking} (NON /shipping/tracking = 404).
    // Struttura: { return: { shipment: [ { shipment:{...}, tracking:[ {data,StatusDescription,phase,officeDescription} ] } ] } }
    const res = await fetch(`https://${cred.master_domain}/api/v2/tracking/${spedizione.tracking_number}`, {
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' }
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = { raw_text: text } }

    const ship: any = data?.return?.shipment
    const first: any = Array.isArray(ship) ? ship[0] : ship
    const eventiRaw: any[] = Array.isArray(first?.tracking) ? first.tracking : []
    // Normalizzo al formato {date, description, location} come SpediamoPro (così il frontend li mostra).
    const eventi = eventiRaw.map((ev: any) => ({
      date: ev.data || ev.date || '',
      description: ev.StatusDescription || ev.appStatusDescription || ev.descrizioneStato || ev.phase || 'Evento',
      location: ev.officeDescription || '',
    }))
    // Stato "più avanzato" (persist)
    const candidati: string[] = []
    for (const k of ['statusDescription', 'descrizioneStato', 'customerStatusDescription']) if (typeof first?.shipment?.[k] === 'string') candidati.push(first.shipment[k])
    for (const ev of eventiRaw) for (const k of ['StatusDescription', 'appStatusDescription', 'phase']) if (typeof ev?.[k] === 'string') candidati.push(ev[k])
    let nuovo: string | null = null
    for (const c of candidati) { const m = mapStatoSpedisci(c); if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m }
    await persistiStato(nuovo)

    return NextResponse.json({ ...base, eventi, status_code: res.status, raw: data })
  } catch(e: any) {
    return NextResponse.json({ ...base, eventi: [], error: e.message, tracking_number: spedizione.tracking_number }, { status: 200 })
  }
}