import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { spediamoproCreatePickup, spediamoproWaitPickupCode, EMAIL_PER_CORRIERE } from '@/lib/spediamopro'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { erroreRitiroPulito } from '@/lib/errore-corriere'
import { siglaProvincia } from '@/lib/province-it'

// Provincia a ESATTAMENTE 2 lettere per SpediamoPro (che rifiuta con 422 "province should have
// exactly 2 characters" se riceve il nome esteso o con spazi). Se non risolvo a 2, torno undefined
// (SpediamoPro accetta l'assenza, mentre un valore errato fa fallire tutto il ritiro).
function provincia2(v: any): string | undefined {
  const p = siglaProvincia(String(v || ''))
  return p && p.length === 2 ? p : undefined
}

// Il corriere (SpediamoPro/Spedisci) può metterci un po' a rispondere sulla creazione ritiro:
// alzo la durata max della funzione così il timeout applicativo (25s) scatta PRIMA di quello di
// Vercel e l'utente riceve un errore pulito invece di un 504.
export const maxDuration = 30
export const dynamic = 'force-dynamic'

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
  return null
}

// Fascia oraria (from/to) richiesta da SpediamoPro
function fasciaOraria(v: any): { from: string; to: string } {
  const s = String(v || '').trim().toLowerCase()
  if (s.includes('matt')) return { from: '09:00', to: '13:00' }
  if (s.includes('pome')) return { from: '14:00', to: '18:00' }
  const hhmm = normalizzaOrario(v)
  if (hhmm) {
    const h = parseInt(hhmm.split(':')[0], 10)
    const toH = Math.min(23, h + 3)
    return { from: hhmm, to: `${String(toH).padStart(2, '0')}:00` }
  }
  return { from: '09:00', to: '18:00' }
}

function pulisciTelefono(v: any): string | undefined {
  if (!v) return undefined
  const d = String(v).replace(/[^0-9]/g, '')  // solo cifre (toglie +, spazi, trattini)
  return d || undefined
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 }) }

  const isCliente = utente.ruolo === 'cliente'
  const admin = createAdminSupabase()
  // Master: può ritirare spedizioni di tutta la propria rete (sotto-albero). Cliente: solo le proprie.
  const masterIdsAmmessi = isCliente ? [utente.master_id] : await sottoAlberoMasterIds(admin, utente.master_id)

  const spedizioneIds = body.spedizioneIds as string[]
  if (!spedizioneIds?.length) return NextResponse.json({ error: 'Seleziona almeno una spedizione da ritirare' }, { status: 400 })

  let spedQuery = admin
    .from('spedizioni')
    .select('id,numero,tracking_number,raw_response,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email,master_id,cliente_id')
    .in('id', spedizioneIds).in('master_id', masterIdsAmmessi)
  if (isCliente) spedQuery = spedQuery.eq('cliente_id', utente.cliente_id)
  // Agente: può ritirare solo spedizioni dei suoi clienti.
  if (isAgente(utente)) spedQuery = spedQuery.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  const { data: spedizioni } = await spedQuery
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })

  const primaSped = spedizioni[0]
  const raw = primaSped.raw_response as any
  // Il ritiro appartiene al master/cliente proprietario della spedizione (così risale nella rete)
  const masterId = primaSped.master_id
  const clienteId = primaSped.cliente_id || null

  const { data: corriere } = await admin.from('corrieri').select('id,tipo,credenziali').eq('id', primaSped.corriere_id).single()
  if (!corriere) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 400 })

  const cred = corriere.credenziali as Record<string, string>

  if (!body.mittNome || !body.mittIndirizzo || !body.mittCitta || !body.mittCap) {
    return NextResponse.json({ error: 'Dati mittente incompleti' }, { status: 400 })
  }
  if (!body.dataRitiro) return NextResponse.json({ error: 'Data ritiro obbligatoria' }, { status: 400 })

  // ── Validazioni PRIMA di chiamare il corriere: data e telefono. Senza questi controlli il
  //    corriere risponde 422 e l'utente vedeva un generico "Ritiro non disponibile" (log 24/07:
  //    stessi clienti in loop di tentativi identici su weekend e telefono vuoto). ──
  {
    const d = new Date(String(body.dataRitiro) + 'T12:00:00')
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'Data ritiro non valida.' }, { status: 400 })
    // "Oggi" nel fuso ITALIANO (il server gira in UTC: tra mezzanotte e le 2 l'UTC è ancora ieri).
    const oggiRoma = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
    if (String(body.dataRitiro) < oggiRoma) return NextResponse.json({ error: 'La data di ritiro è già passata: scegli una data da oggi in poi.' }, { status: 400 })
    if ([0, 6].includes(d.getDay())) {
      return NextResponse.json({ error: 'La data scelta cade di sabato o domenica: i corrieri ritirano solo nei giorni lavorativi (lun–ven). Scegli un\'altra data.' }, { status: 400 })
    }
  }
  // Telefono mittente OBBLIGATORIO: il corriere lo richiede per prenotare il ritiro (senza, il
  // provider rifiuta con 422 "contactInfo.phone should be of type string").
  if (!pulisciTelefono(body.mittTelefono) || String(pulisciTelefono(body.mittTelefono)).length < 6) {
    return NextResponse.json({ error: 'Inserisci un numero di telefono valido del mittente: il corriere lo richiede per prenotare il ritiro.' }, { status: 400 })
  }

  const colliTotali = spedizioni.reduce((sum, s) => sum + (s.colli || 1), 0)
  const pesoTotale = spedizioni.reduce((sum, s) => sum + (parseFloat(String(s.peso_reale)) || 1), 0)

  // Funzione comune di salvataggio su DB
  async function salvaRitiro(pickupCode: string, pickupId?: number | null) {
    const r = await admin.from('ritiri').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriere!.id,
      pickup_id: pickupId || null,   // id numerico SpediamoPro: serve per leggere lo stato (prenotato/elaborato)
      tracking_ritiro: pickupCode || null, cod_ritiro: pickupCode || null,
      mitt_nome: body.mittNome, mitt_indirizzo: body.mittIndirizzo, mitt_citta: body.mittCitta,
      mitt_provincia: body.mittProvincia || null, mitt_cap: body.mittCap,
      mitt_telefono: body.mittTelefono || null,
      colli: colliTotali, peso: pesoTotale, contenuto: body.contenuto || null,
      data_ritiro: body.dataRitiro, stato: 'richiesto',
    }).select().single()
    // Marco le spedizioni come "messe in un ritiro" -> escono dai ritirabili (niente doppioni).
    if (r.data?.id) { try { await admin.from('spedizioni').update({ ritiro_id: r.data.id }).in('id', spedizioneIds) } catch {} }
    return r
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
          phone: pulisciTelefono(body.mittTelefono),
          email: body.mittEmail || undefined,
          province: provincia2(body.mittProvincia),
        },
        date: body.dataRitiro,
        from: fascia.from,
        to: fascia.to,
        shipments: shipmentIds,
        courier: courierCode,
      })
      // Il POST non restituisce sempre il code (CP...): lo recupero con una GET
      let codicePickup = pk.code
      if (!codicePickup && pk.id) {
        codicePickup = await spediamoproWaitPickupCode(cred.authcode, pk.id)
      }
      console.log('[RITIRO][SPEDIAMOPRO] pickup creato:', codicePickup, 'id:', pk.id)

      const { data: nuovoRitiro, error: insErr } = await salvaRitiro(codicePickup || String(pk.id), pk.id || null)
      if (insErr) {
        return NextResponse.json({ error: `Ritiro creato (${pk.code}) ma errore DB: ${insErr.message}` }, { status: 500 })
      }
      return NextResponse.json({ id: nuovoRitiro.id, pickupId: pk.code || pk.id })
    } catch (e: any) {
      console.log('[RITIRO][SPEDIAMOPRO] errore:', e?.message)
      return NextResponse.json({ error: erroreRitiroPulito(e) }, { status: 400 })
    }
  }

  // ══════════════════════════════════════════════════════
  // RAMO SPEDISCI.ONLINE (flusso esistente)
  // ══════════════════════════════════════════════════════
  const carrierCode = raw?._carrierCode
  // spedisci.online per il RITIRO vuole come "shipmentId" la LDV/tracking della spedizione
  // (il numero che il portale chiede come "riferimento LDV"), NON l'id numerico interno.
  // Con l'id numerico il ramo Poste (postedeliverybusiness) si APPENDE (spedisci interroga Poste
  // e non torna più → timeout); con la LDV risolve all'istante. Verificato: GLS/SDA vanno bene
  // con entrambi, Poste SOLO con la LDV. Fallback all'id numerico solo se la LDV manca del tutto.
  const shipmentId = raw?.trackingNumber || primaSped.tracking_number || primaSped.numero || raw?.shipmentId
  if (!carrierCode) return NextResponse.json({ error: 'Impossibile recuperare il corriere dalla spedizione.' }, { status: 400 })

  const baseUrl = `https://${cred.master_domain}/api/v2`
  const pickupTime = normalizzaOrario(body.orarioRitiro)

  const shipFrom = {
    name: body.mittNome, company: body.mittNome, street1: body.mittIndirizzo, street2: '',
    city: body.mittCitta, state: siglaProvincia(body.mittProvincia || '') || (body.mittProvincia || ''), postalCode: body.mittCap,
    country: body.mittPaese || 'IT', phone: pulisciTelefono(body.mittTelefono) || null, email: EMAIL_PER_CORRIERE,
  }

  // Riuso il contratto GIÀ usato per creare la spedizione (salvato in raw_response._contractCode):
  // è quello giusto per il ritiro. Solo se manca ripiego sui rates (flusso legacy, fragile).
  let contractCode: string | null = raw?._contractCode || null
  if (!contractCode) try {
    const ratesBody = {
      packages: [{ length: primaSped.lunghezza || 20, width: primaSped.larghezza || 15, height: primaSped.altezza || 10, weight: pesoTotale || 1 }],
      shipFrom,
      shipTo: {
        name: primaSped.dest_nome || 'Destinatario', company: '', street1: primaSped.dest_indirizzo || '', street2: '',
        city: primaSped.dest_citta || '', state: primaSped.dest_provincia || '', postalCode: primaSped.dest_cap || '',
        country: primaSped.dest_paese || 'IT', phone: null, email: primaSped.dest_email || 'noreply@moovexpress.com',
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
      // Prima per codice_contratto (contratto esatto di questo corriere), poi per carrierCode
      const { trovaRateContratto } = await import('@/lib/spedisci')
      const match = trovaRateContratto(rates, cred)
        || rates.find((r: any) => r.carrierCode === carrierCode) || rates[0]
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
  // Timeout: l'API del corriere a volte si appende. Senza limite la funzione va in 504 (Vercel)
  // dopo minuti; con AbortController torno un errore pulito e veloce, riprovabile.
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 25000)
  let res: Response
  try {
    res = await fetch(`${baseUrl}/pickup/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
  } catch (e: any) {
    clearTimeout(to)
    return NextResponse.json({ error: 'Il corriere non ha risposto in tempo per il ritiro. Riprova; se persiste, quel contratto non gestisce il ritiro via app (es. Poste): programma il ritiro dal portale del corriere.' }, { status: 504 })
  }
  clearTimeout(to)
  let text = await res.text()
  console.log('[RITIRO] Risposta pickup/create status:', res.status, 'body:', text.substring(0, 500))

  // Spedisci NON accetta piu' il ritiro IN GIORNATA ("PICKUP_DATE = today is no longer possible"):
  // riprovo in automatico col primo giorno LAVORATIVO utile, cosi' il ritiro parte comunque
  // (il "richiedi ritiro" da nuova spedizione propone oggi come data).
  let dataSpostata: string | null = null
  if (!res.ok && /PICKUP_DATE\s*=\s*today/i.test(text)) {
    const prossimo = new Date(String(body.dataRitiro) + 'T12:00:00')
    do { prossimo.setDate(prossimo.getDate() + 1) } while ([0, 6].includes(prossimo.getDay()))
    dataSpostata = prossimo.toISOString().slice(0, 10)
    payload.pickupDate = dataSpostata
    console.log('[RITIRO] Ritiro in giornata rifiutato da Spedisci: riprovo per', dataSpostata)
    const ctrl2 = new AbortController()
    const to2 = setTimeout(() => ctrl2.abort(), 25000)
    try {
      res = await fetch(`${baseUrl}/pickup/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl2.signal,
      })
      text = await res.text()
      console.log('[RITIRO] Risposta retry pickup/create status:', res.status, 'body:', text.substring(0, 300))
      if (res.ok) body.dataRitiro = dataSpostata   // il ritiro salvato porta la data REALE
      else dataSpostata = null
    } catch {
      clearTimeout(to2)
      return NextResponse.json({ error: 'Il corriere non ha risposto in tempo per il ritiro. Riprova tra qualche minuto.' }, { status: 504 })
    }
    clearTimeout(to2)
  }

  let r: any
  try { r = JSON.parse(text) } catch { r = { error: text.substring(0, 300) } }
  if (!res.ok || r.error) {
    return NextResponse.json({ error: erroreRitiroPulito(r?.error || `Errore ${res.status}`) }, { status: 400 })
  }

  // Codice ritiro del corriere: spedisci lo restituisce come pickupId (CP…) o, in alcune versioni,
  // come id/uuid/code/reference. Prendo il primo disponibile.
  const codiceCorriere = r.pickupId ?? r.pickup_id ?? r.id ?? r.uuid ?? r.code ?? r.reference ?? null
  const { data: nuovoRitiro, error: insertError } = await salvaRitiro(codiceCorriere)
  if (insertError) {
    return NextResponse.json({ error: `Ritiro creato (${codiceCorriere}) ma errore DB: ${insertError.message}` }, { status: 500 })
  }
  // `id` = riferimento interno MoovExpress; `pickupId` = codice del corriere (es. CP…).
  return NextResponse.json({
    id: nuovoRitiro.id, pickupId: codiceCorriere,
    ...(dataSpostata ? { avviso: `Il corriere non accetta più il ritiro in giornata: ritiro programmato per il ${dataSpostata.split('-').reverse().join('/')}.` } : {}),
  })
}
