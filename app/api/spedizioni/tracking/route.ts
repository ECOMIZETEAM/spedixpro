import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { spediamoproGetTracking, mapStatoSpediamopro } from '@/lib/spediamopro'
import { prioritaStato } from '@/lib/spedisci'

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
  // Ritorna lo stato EFFETTIVO dopo l'allineamento: il frontend lo usa per aggiornare badge e riga
  // in elenco (prima il popup mostrava eventi live ma il badge restava quello vecchio della lista).
  let statoEffettivo: string = (spedizione as any).stato
  const persistiStato = async (nuovo: string | null) => {
    if (!nuovo || nuovo === 'eccezione' || nuovo === (spedizione as any).stato) return
    if ((spedizione as any).stato === 'consegnata' || (spedizione as any).stato === 'annullata') return
    // SOLO IN AVANTI: il corriere può essere "indietro" rispetto a noi (es. 'spedita' dopo la
    // distinta mentre lui dice ancora "in lavorazione"): mai declassare lo stato.
    if (nuovo !== 'annullata' && prioritaStato(nuovo) <= prioritaStato((spedizione as any).stato)) return
    try { await admin.from('spedizioni').update({ stato: nuovo }).eq('id', spedizione.id); statoEffettivo = nuovo } catch {}
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
      if (!spid || !authcode) return NextResponse.json({ ...base, eventi: [], stato: statoEffettivo, error: 'Tracking non disponibile per questa spedizione' })
      const tr = await spediamoproGetTracking(authcode, Number(spid))
      await persistiStato(mapStatoSpediamopro(tr.status))
      // RECUPERO NUMERO al volo: se il numero è ancora il codice interno SpediamoPro (raw.code) e ora
      // esiste il tracking reale del corriere, correggo subito (senza aspettare il giro del cron).
      if (tr.trackingCode && tr.trackingCode !== spedizione.numero && (spedizione.numero === raw.code || String(spedizione.numero || '').startsWith('SP-'))) {
        try { await admin.from('spedizioni').update({ numero: tr.trackingCode, tracking_number: tr.trackingCode }).eq('id', spedizione.id) } catch {}
        ;(base as any).numero = tr.trackingCode
        ;(base as any).tracking_number = tr.trackingCode
      }
      const eventi = (tr.events || []).map((e: any) => ({
        date: e.at || e.date || '',
        description: [e.title, e.description].filter(Boolean).join(' — ') || 'Evento',
        location: '',
      })).reverse()   // più recente in alto
      return NextResponse.json({ ...base, eventi, stato: statoEffettivo, status_code: 200, raw: tr })
    }

    // Spedisci.online ha CHIUSO il polling del tracking (403 "For tracking please use the Webhooks
    // events"): gli eventi arrivano in tempo reale dal WEBHOOK e vengono salvati in tracking_events.
    // Il popup mostra quelli (lo stato è già allineato dal webhook stesso, solo-in-avanti).
    const { data: evDb } = await admin.from('tracking_events')
      .select('stato,descrizione,luogo,data_evento')
      .eq('spedizione_id', spedizione.id)
      .order('data_evento', { ascending: false })
    const eventi = (evDb || []).map((e: any) => ({
      date: e.data_evento || '',
      description: e.descrizione || 'Evento',
      location: e.luogo || '',
    }))
    return NextResponse.json({ ...base, eventi, stato: statoEffettivo, status_code: 200 })
  } catch(e: any) {
    return NextResponse.json({ ...base, eventi: [], stato: statoEffettivo, error: e.message, tracking_number: spedizione.tracking_number }, { status: 200 })
  }
}