import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { prenotaRitiroSpediamopro } from '@/lib/ritiro-spediamopro'
import { inviaRitiroSpedisci } from '@/lib/ritiro-spedisci'
import { avvisoDataSpostata } from '@/lib/ritiro-giorno'
import { erroreRitiroPulito } from '@/lib/errore-corriere'
import { pickupTimeSpedisci } from '@/lib/spedisci'
import { ritiroPrenotabileConPickups, messaggioRitiroNonPrenotabileViaApi, avvisoCodiceInArrivo } from '@/lib/ritiro-api'
import { codiceRitiroValido } from '@/lib/easyparcel'

// API pubblica MoovExpress — richiede un ritiro per spedizioni del contratto della API key
// (SpediamoPro, Spedisci, Poste diretto, Dielle e i ponti che finiscono su uno di questi due, come SDA EXPRESS L e PDB L).
// Auth: Authorization: Bearer <api_key>
// Body: { shipmentIds:[uuid], date:'YYYY-MM-DD' (giorno LAVORATIVO, no sab/dom), timeFrom?, timeTo?, from:{name,street1,city,state,postalCode,phone,email?}, notes? }
// NB: from.phone è OBBLIGATORIO (>=6 cifre): i corrieri lo richiedono per prenotare il ritiro.
export const maxDuration = 30
export const dynamic = 'force-dynamic'

function pulisciTelefono(v: any): string | undefined {
  if (!v) return undefined
  const d = String(v).replace(/[^0-9]/g, '')
  return d || undefined
}
function fasciaOraria(from: any, to: any): { from: string; to: string } {
  const hhmm = (v: any) => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? `${String(Math.min(23, +m[1])).padStart(2, '0')}:${m[2]}` : null }
  const f = hhmm(from), t = hhmm(to)
  if (f && t) return { from: f, to: t }
  if (f) { const h = Math.min(23, parseInt(f) + 3); return { from: f, to: `${String(h).padStart(2, '0')}:00` } }
  return { from: '09:00', to: '18:00' }
}

// CONTRATTI "V" (easyparcel): il ritiro sta dentro l'ordine e si chiede SOLO alla creazione — il
// fornitore non ha una chiamata per aggiungerlo dopo (lo scrive la sua documentazione). Qui quindi non
// si prenota niente: si risponde per quello che c'e', con la stessa regola del dettaglio spedizione.
// Prima rispondeva 400 a tutto, anche dove il ritiro era gia' prenotato alla creazione: il programma
// di chi integra lo leggeva come un ritiro fallito e riprovava (CONTORNO SRL, 100 chiamate respinte il
// 15-16/11/2026). Ora l'errore resta solo sulle spedizioni create davvero senza ritiro; le altre si
// confermano col codice, come fa il portale (giaPrenotato).
async function ritiroContrattoV(admin: any, ctx: { clienteId: string; corriereId: string }, body: any) {
  const shipmentIds = body.shipmentIds
  if (!Array.isArray(shipmentIds) || !shipmentIds.length) return NextResponse.json({ error: 'shipmentIds obbligatorio' }, { status: 400 })
  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,richiedi_ritiro,data_ritiro,cod_ritiro:raw_response->>_codiceRitiro')
    .in('id', shipmentIds).eq('cliente_id', ctx.clienteId).eq('corriere_id', ctx.corriereId)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })

  const senzaRitiro: string[] = spedizioni.filter((s: any) => !s.richiedi_ritiro).map((s: any) => s.id)
  if (senzaRitiro.length) {
    const conRitiro = spedizioni.length - senzaRitiro.length
    return NextResponse.json({
      error: 'Per questo contratto il ritiro va richiesto al momento della creazione della spedizione: non puo\' essere aggiunto dopo. '
        + (senzaRitiro.length === 1
          ? 'Una spedizione e\' stata creata senza ritiro (indicata in senzaRitiro): per questa contatta l\'assistenza.'
          : `${senzaRitiro.length} spedizioni sono state create senza ritiro (elencate in senzaRitiro): per queste contatta l'assistenza.`)
        + (conRitiro ? ` ${conRitiro === 1 ? 'L\'altra ha' : `Le altre ${conRitiro} hanno`} gia\' il ritiro prenotato alla creazione.` : ''),
      senzaRitiro,
    }, { status: 400 })
  }

  const ritiri: { shipmentId: string; codice_ritiro: string | null; date: string | null }[] =
    spedizioni.map((s: any) => ({ shipmentId: s.id, codice_ritiro: codiceRitiroValido(s.cod_ritiro), date: s.data_ritiro || null }))
  // Ogni ordine ha il suo codice: in cima se ne mette uno solo quando e' lo stesso per tutte, per non
  // far credere che un codice valga anche per spedizioni che ne hanno un altro.
  const codici = new Set(ritiri.map(r => r.codice_ritiro))
  const unico = codici.size === 1 ? ritiri[0].codice_ritiro : null
  const avvisi = ['Il ritiro di queste spedizioni e\' stato prenotato alla creazione: non ne e\' stato prenotato un altro.']
  if (body.date && ritiri.some(r => r.date && r.date !== String(body.date))) avvisi.push('La data del ritiro e\' quella scelta alla creazione e non si puo\' cambiare.')
  const senzaCodice = ritiri.find(r => !r.codice_ritiro)
  if (senzaCodice) avvisi.push(avvisoCodiceInArrivo(senzaCodice.shipmentId))
  return NextResponse.json({
    id: null, codice_ritiro: unico, pickupId: unico, stato: 'richiesto', date: ritiri[0].date,
    giaPrenotato: true, ritiri, avviso: avvisi.join(' '),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()

  // IL CONTRATTO PRIMA DI TUTTO. Chi chiama un ritiro su un contratto dove questa rotta non puo'
  // prenotarlo deve saperlo subito, non dopo aver corretto data, mittente e telefono per poi
  // sentirsi dire una cosa sbagliata: sui ponti e su Poste diretto rispondeva "Impossibile
  // recuperare il corriere dalla spedizione", che manda a cercare il guasto dalla parte sbagliata.
  {
    const { data: contratto } = await admin.from('corrieri').select('tipo').eq('id', ctx.corriereId).maybeSingle()
    // ── SU QUESTI CONTRATTI IL RITIRO NON SI AGGIUNGE DOPO ──
    // Non c'e' un ramo per questo tipo, e senza un'uscita esplicita la richiesta finiva nel ramo
    // spedisci: cercava un codice corriere che quelle spedizioni non hanno MAI (verificato: assente
    // su tutte e 1.264) e rispondeva "Impossibile recuperare il corriere dalla spedizione", mandando
    // a cercare il guasto dalla parte sbagliata. Il fornitore non ha proprio una chiamata per
    // prenotare un ritiro dopo l'ordine: si chiede alla creazione o non si chiede piu'.
    // Chi l'ha chiesto alla creazione ce l'ha gia': si conferma; il rifiuto resta per chi l'ha creata
    // senza (vedi ritiroContrattoV).
    if (contratto?.tipo === 'easyparcel') return ritiroContrattoV(admin, ctx, body)
    if (contratto && !ritiroPrenotabileConPickups(contratto.tipo)) {
      return NextResponse.json({ error: messaggioRitiroNonPrenotabileViaApi(contratto.tipo) }, { status: 400 })
    }
  }

  const shipmentIds = body.shipmentIds
  if (!Array.isArray(shipmentIds) || !shipmentIds.length) return NextResponse.json({ error: 'shipmentIds obbligatorio' }, { status: 400 })
  if (!body.date) return NextResponse.json({ error: 'date obbligatoria (YYYY-MM-DD)' }, { status: 400 })
  {
    // Stessa validazione del portale: senza, il corriere rifiuta con un 422 poco chiaro.
    const d = new Date(String(body.date) + 'T12:00:00')
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'date non valida (YYYY-MM-DD)' }, { status: 400 })
    // "Oggi" nel fuso ITALIANO (il server gira in UTC: tra mezzanotte e le 2 l'UTC è ancora ieri).
    const oggiRoma = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
    if (String(body.date) < oggiRoma) return NextResponse.json({ error: 'La data di ritiro è già passata: usa una data da oggi in poi.' }, { status: 400 })
    if ([0, 6].includes(d.getDay())) return NextResponse.json({ error: 'La data di ritiro cade di sabato o domenica: i corrieri ritirano solo nei giorni lavorativi (lun-ven).' }, { status: 400 })
  }
  const from = body.from || {}
  if (!from.name || !from.street1 || !from.city || !from.postalCode) return NextResponse.json({ error: 'Mittente (from) incompleto: name, street1, city, postalCode' }, { status: 400 })
  if (!pulisciTelefono(from.phone) || String(pulisciTelefono(from.phone)).length < 6) {
    return NextResponse.json({ error: 'from.phone obbligatorio: il corriere richiede un telefono del mittente per il ritiro.' }, { status: 400 })
  }

  // Solo spedizioni del cliente e del contratto della key
  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,raw_response,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email,mitt_nome,mitt_indirizzo,mitt_citta,mitt_provincia,mitt_cap,ritiro_id')
    .in('id', shipmentIds).eq('cliente_id', ctx.clienteId).eq('corriere_id', ctx.corriereId)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 400 })

  const { data: corriere } = await admin.from('corrieri').select('id,tipo,credenziali,settings').eq('id', ctx.corriereId).single()
  if (!corriere) return NextResponse.json({ error: 'Contratto non trovato' }, { status: 400 })
  const cred = corriere.credenziali as Record<string, string>

  // ── POSTE DIRETTO, anche attraverso un ponte di condivisione (SDA EXPRESS L) ──
  // Le stesse funzioni del portale (lib/ritiro-poste): sul ponte prenota il contratto vero dello stesso
  // pacco. Se quel contratto non e' Poste diretto, qui non c'e' un ramo e lo si dice.
  if (corriere.tipo === 'poste' || corriere.tipo === 'moovexpress' || corriere.tipo === 'dielle') {
    const { contrattoCheRitira, prenotaRitiroPoste } = await import('@/lib/ritiro-poste')
    // Un secondo invio dello stesso lotto (risposta persa, nuovo tentativo) prenoterebbe presso il
    // corriere un secondo ritiro per gli stessi pacchi: quelli gia' in un ritiro restano fuori.
    const daRitirare = spedizioni.filter((s: any) => !s.ritiro_id)
    if (!daRitirare.length) {
      const { data: esistente } = await admin.from('ritiri').select('id,cod_ritiro,data_ritiro').eq('id', (spedizioni[0] as any).ritiro_id).maybeSingle()
      return NextResponse.json({
        id: esistente?.id || null, codice_ritiro: esistente?.cod_ritiro || null, pickupId: esistente?.cod_ritiro || null,
        stato: 'richiesto', date: esistente?.data_ritiro || null, giaPrenotato: true,
        avviso: 'Queste spedizioni sono gia\' in un ritiro prenotato: non ne e\' stato prenotato un altro.',
      })
    }
    const ritira = await contrattoCheRitira(admin, corriere, (daRitirare[0] as any).tracking_number)
    if ('errore' in ritira) return NextResponse.json({ error: messaggioRitiroNonPrenotabileViaApi(corriere.tipo) }, { status: 400 })
    if (ritira.corriere?.tipo !== 'poste' && ritira.corriere?.tipo !== 'dielle') return NextResponse.json({ error: messaggioRitiroNonPrenotabileViaApi(corriere.tipo) }, { status: 400 })
    // DIELLE (PDB L e gli altri "L"), anche dietro un ponte: la stessa prenotazione del portale.
    // Il numero presso il fornitore è lo stesso tracking su tutte le gambe del pacco.
    const fasciaDl = fasciaOraria(body.timeFrom, body.timeTo)
    const esito = ritira.corriere.tipo === 'dielle'
      ? await (await import('@/lib/ritiro-dielle')).prenotaRitiroDielle(admin, {
        corriere: ritira.corriere, masterId: ctx.masterId, clienteId: ctx.clienteId, spedizioni: daRitirare as any[],
        ldv: daRitirare.map((s: any) => String(s.raw_response?.ldv || s.tracking_number || s.numero || '')).filter(Boolean),
        mittente: {
          nome: from.name, indirizzo: from.street1, citta: from.city, cap: from.postalCode,
          provincia: from.state, paese: from.country, telefono: pulisciTelefono(from.phone), email: from.email,
        },
        data: String(body.date), orario: { da: fasciaDl.from, a: fasciaDl.to },
        note: body.notes, contenuto: body.notes,
      })
      : await prenotaRitiroPoste(admin, {
      corriere: ritira.corriere, masterId: ctx.masterId, clienteId: ctx.clienteId, spedizioni: daRitirare as any[],
      mittente: {
        nome: from.name, indirizzo: from.street1, citta: from.city, cap: from.postalCode,
        provincia: from.state, paese: from.country, telefono: pulisciTelefono(from.phone), email: from.email,
      },
      data: String(body.date), fascia: pickupTimeSpedisci(body.timeFrom) === 'PM' ? 'PM' : 'AM',
      note: body.notes, contenuto: body.notes,
    })
    if (!esito.ok && esito.motivo === 'registrazione') {
      console.error('[API][PICKUP][POSTE] salvataggio ritiro fallito:', esito.errore)
      return NextResponse.json({ error: `Ritiro creato presso il corriere (${esito.codice}) ma non registrato a sistema: contatta l'assistenza indicando questo codice.` }, { status: 500 })
    }
    if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: 400 })
    const esclusi = spedizioni.length - daRitirare.length
    // Chi integra ha chiesto una data precisa: se il corriere l'ha rifiutata e il ritiro e' andato al
    // giorno dopo, la risposta porta la data vera e lo dice, come per Spedisci qui sotto.
    const avvisi = [
      avvisoDataSpostata(String(body.date), esito.data),
      esclusi ? `${esclusi} ${esclusi === 1 ? 'spedizione era gia\'' : 'spedizioni erano gia\''} in un ritiro prenotato e non ${esclusi === 1 ? 'e\' stata inclusa' : 'sono state incluse'}.` : null,
    ].filter(Boolean)
    return NextResponse.json({
      id: esito.ritiroId, codice_ritiro: esito.codice, pickupId: esito.codice, stato: 'richiesto', date: esito.data,
      ...(avvisi.length ? { avviso: avvisi.join(' ') } : {}),
    })
  }

  const colliTotali = spedizioni.reduce((s: number, x: any) => s + (x.colli || 1), 0)
  const pesoTotale = spedizioni.reduce((s: number, x: any) => s + (parseFloat(String(x.peso_reale)) || 1), 0)
  const fascia = fasciaOraria(body.timeFrom, body.timeTo)

  // pickupId: il numero del ritiro presso il fornitore, come lo salva il portale. Senza, il giro che rilegge
  // codice del corriere e stato (lib/ritiro-codice) non trovava i ritiri nati da qui (181 in 30 giorni, 25/11).
  async function salvaRitiro(pickupCode: string, dataRitiro: string = body.date, pickupId: number | null = null) {
    const r = await admin.from('ritiri').insert({
      master_id: ctx!.masterId, cliente_id: ctx!.clienteId, corriere_id: corriere!.id,
      tracking_ritiro: pickupCode || null, cod_ritiro: pickupCode || null,
      ...(pickupId ? { pickup_id: pickupId } : {}),
      mitt_nome: from.name, mitt_indirizzo: from.street1, mitt_citta: from.city,
      mitt_provincia: from.state || null, mitt_cap: from.postalCode, mitt_telefono: pulisciTelefono(from.phone) || null,
      colli: colliTotali, peso: pesoTotale, contenuto: body.notes || null,
      data_ritiro: dataRitiro, stato: 'richiesto',
    }).select('id').single()
    // Come il portale: le spedizioni si legano al ritiro. Senza, il dettaglio via API non poteva
    // mostrarne il codice e nel portale restavano fra le "da ritirare", pronte per un doppione.
    if (r.data?.id) {
      const { error: linkErr } = await admin.from('spedizioni').update({ ritiro_id: r.data.id }).in('id', spedizioni!.map((s: any) => s.id))
      if (linkErr) console.error('[API][PICKUP] collegamento spedizioni al ritiro fallito:', r.data.id, linkErr.message)
    }
    return r
  }

  // ── SPEDIAMOPRO ──
  if (corriere.tipo === 'spediamopro') {
    const shipmentApiIds: number[] = []
    let courierCode = 'sda'
    for (const s of spedizioni) {
      const r = s.raw_response as any
      const sid = r?.id || r?.raw?.data?.id
      if (sid) shipmentApiIds.push(Number(sid))
      const cc = r?.raw?.data?.courierService?.courier
      if (cc) courierCode = cc
    }
    if (!shipmentApiIds.length) return NextResponse.json({ error: 'Impossibile recuperare gli ID spedizione' }, { status: 400 })
    // Le stesse correzioni del portale (lib/ritiro-spediamopro): lunghezze, giorno, indirizzo del mittente.
    const s0: any = spedizioni[0]
    const esito = await prenotaRitiroSpediamopro(cred.authcode, {
      contactInfo: {
        name: from.name, address: from.street1, postalCode: from.postalCode, city: from.city,
        country: from.country || 'IT', phone: pulisciTelefono(from.phone), email: from.email || undefined,
        province: from.state || undefined,
      },
      mittenteSpedizione: { nome: s0.mitt_nome, indirizzo: s0.mitt_indirizzo, cap: s0.mitt_cap, citta: s0.mitt_citta, provincia: s0.mitt_provincia },
      date: body.date, from: fascia.from, to: fascia.to, shipments: shipmentApiIds, courier: courierCode,
    })
    if (!esito.ok) return NextResponse.json({ error: erroreRitiroPulito(esito.errore) }, { status: 400 })
    const { data: nuovo, error } = await salvaRitiro(esito.codice, esito.data, esito.id)
    if (error) { console.error('[API][PICKUP] salvataggio ritiro fallito:', error.message); return NextResponse.json({ error: `Ritiro creato presso il corriere (${esito.codice}) ma non registrato a sistema: contatta l'assistenza indicando questo codice.` }, { status: 500 }) }
    const avviso = avvisoDataSpostata(String(body.date), esito.data)
    return NextResponse.json({ id: nuovo.id, pickupId: esito.codice, stato: 'richiesto', date: esito.data, ...(avviso ? { avviso } : {}) })
  }

  // I contratti che questa rotta non sa prenotare (easyparcel, …) sono gia' usciti in cima, Poste
  // diretto e i ponti qui sopra: da qui in giu' resta solo SPEDISCI.

  // ── SPEDISCI ──
  const primaSped: any = spedizioni[0]
  const raw = primaSped.raw_response as any
  const carrierCode = raw?._carrierCode
  // Per il ritiro spedisci.online serve la LDV/tracking come "shipmentId": con l'id numerico il ramo
  // Poste si appende (timeout). Fallback all'id numerico solo se la LDV manca del tutto. (Come flusso principale.)
  const shipmentId = raw?.trackingNumber || primaSped.tracking_number || primaSped.numero || raw?.shipmentId
  if (!carrierCode) return NextResponse.json({ error: 'Impossibile recuperare il corriere dalla spedizione' }, { status: 400 })
  const baseUrl = `https://${cred.master_domain}/api/v2`
  const shipFrom = {
    name: from.name, company: from.name, street1: from.street1, street2: '', city: from.city,
    state: from.state || '', postalCode: from.postalCode, country: from.country || 'IT',
    phone: pulisciTelefono(from.phone) || null, email: from.email || 'noreply@moovexpress.com',
  }

  let contractCode: string | null = null
  try {
    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packages: [{ length: primaSped.lunghezza || 20, width: primaSped.larghezza || 15, height: primaSped.altezza || 10, weight: pesoTotale || 1 }],
        shipFrom,
        shipTo: { name: primaSped.dest_nome || 'Destinatario', company: '', street1: primaSped.dest_indirizzo || '', street2: '', city: primaSped.dest_citta || '', state: primaSped.dest_provincia || '', postalCode: primaSped.dest_cap || '', country: primaSped.dest_paese || 'IT', phone: null, email: primaSped.dest_email || 'noreply@moovexpress.com' },
        notes: 'pickup', insuranceValue: 0, codValue: 0, accessoriServices: [],
      }),
    })
    const rates = await ratesRes.json()
    if (Array.isArray(rates) && rates.length) contractCode = ((cred.codice_contratto && rates.find((r: any) => r.contractCode === cred.codice_contratto)) || rates.find((r: any) => r.carrierCode === carrierCode) || rates[0])?.contractCode || null
  } catch (e: any) { console.error('API pickup rates:', e?.message) }
  if (!contractCode) return NextResponse.json({ error: 'Impossibile recuperare il codice contratto per il ritiro' }, { status: 400 })

  // pickupTime come ENUM AM/PM/AMPM (dal 10/9 spedisci rifiuta "HH:MM" con 400 "pickupTime must be
  // one of AM, PM, AMPM"). Il portale era stato corretto, questa porta no: i ritiri spedisci via API
  // fallivano tutti da allora. Funzione condivisa, così le due porte restano allineate.
  const payload: any = { contractCode, carrierCode, pickupDate: body.date, shipFrom, packagesDetails: [{ weight: String(pesoTotale || 1) }], pickupTime: pickupTimeSpedisci(body.timeFrom) }
  if (body.notes) payload.specialInstruction = body.notes
  if (shipmentId) payload.shipmentId = shipmentId

  // Invio, nomi oltre 35 caratteri e "non oggi" stanno in lib/ritiro-spedisci, come per il portale.
  // Qui pero' chi integra ha chiesto una data precisa: se il corriere la sposta, la risposta porta la
  // data vera e un avviso, non la cambia in silenzio. La scadenza tiene la richiesta sotto i 30 secondi.
  const invio = await inviaRitiroSpedisci(baseUrl, cred.password, payload, Date.now() + 27000)
  // Chi integra parla solo con noi: niente rimandi al portale del corriere.
  if (invio.timeout) return NextResponse.json({ error: 'Il corriere non ha risposto in tempo per il ritiro. Riprova tra qualche minuto; se persiste, contatta l\'assistenza.' }, { status: 504 })
  const dataRitiroFinale = invio.data
  const r: any = invio.risposta || {}
  // L'errore del fornitore a valle va SEMPRE ripulito (nomi tecnici/dominio) prima di uscire — come
  // fa il ramo SpediamoPro qui sopra. Senza, il testo grezzo del provider arriverebbe al partner.
  if (!invio.ok) return NextResponse.json({ error: r?.error ? erroreRitiroPulito(r.error) : `Errore ${invio.status}` }, { status: 400 })

  // Codice ritiro del corriere: spedisci può restituirlo come pickupId (CP…) o, in alcune versioni,
  // come id/uuid/code/reference. Prendo il primo disponibile così salviamo sempre il riferimento giusto.
  const codiceCorriere = r.pickupId ?? r.pickup_id ?? r.id ?? r.uuid ?? r.code ?? r.reference ?? null
  const { data: nuovo, error } = await salvaRitiro(codiceCorriere, dataRitiroFinale)
  if (error) { console.error('[API][PICKUP] salvataggio ritiro fallito:', error.message); return NextResponse.json({ error: `Ritiro creato presso il corriere (${codiceCorriere}) ma non registrato a sistema: contatta l'assistenza indicando questo codice.` }, { status: 500 }) }
  // NB: `id` = riferimento interno MoovExpress (UUID). `codice_ritiro`/`pickupId` = codice del CORRIERE (es. CP…).
  return NextResponse.json({
    id: nuovo.id, codice_ritiro: codiceCorriere, pickupId: codiceCorriere, stato: 'richiesto', date: dataRitiroFinale,
    ...(avvisoDataSpostata(String(body.date), dataRitiroFinale) ? { avviso: avvisoDataSpostata(String(body.date), dataRitiroFinale) } : {}),
  })
}
