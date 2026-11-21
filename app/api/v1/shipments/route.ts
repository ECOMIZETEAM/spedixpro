import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { conMemoRichiesta } from '@/lib/memo-richiesta'
import { cronometra, annota } from '@/lib/cronometro'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { registraMovimento, descrizioneSpedizione } from '@/lib/movimenti'
import { addebitaCatena } from '@/lib/cascata'
import { addebitaTreeCondivisione, risolviChiaveDispatch } from '@/lib/condivisione-catena'
import { inviaWebhook } from '@/lib/webhooks'
import { erroreCorrierePulito, MSG_PONTE_NON_CONCLUSO, MSG_PONTE_NON_REGISTRATA } from '@/lib/errore-corriere'
import { statoPiano, messaggioBlocco } from '@/lib/limite-piano'
import { spedizioneDoppioneAttiva, messaggioDoppione } from '@/lib/guardia-doppione'
import { emailAlCorriere } from '@/lib/email-corriere'
import { ritiroInRisposta, messaggioRitiroNonPrenotabileViaApi } from '@/lib/ritiro-api'
import { modalitaCodPoste, modalitaCodDaRichiesta, type ModalitaCod } from '@/lib/contrassegno-modalita'
import { EMAIL_PER_CORRIERE,
  spediamoproGetQuotation, spediamoproCreateShipment, spediamoproGetLabel,
  spediamoproWaitForTracking, kgToGrams, cmToMm, euroToCents, centsToEuro,
  normalizzaEtichetta, telValidoSp, indirizzoEtichetta,
} from '@/lib/spediamopro'
import { depositoInRisposta } from '@/lib/punti-consegna'
import { PONTE_HDR_RICHIESTA, scadenzaRichiesta, MINIMO_CREAZIONE_MS } from '@/lib/moovexpress'
import { valutaLivelloV1 } from '@/lib/v1-livello'
import { ldvPosteV1 } from '@/lib/v1-poste'
import { corpoPerIlVenditoreV1, rigaV1, parametriAlberoV1, parametriCatenaV1 } from '@/lib/v1-riga'
import { apriRichiestaPonte, chiudiRichiestaPonte, leggiRichiestaPonte, codiceRichiestaValido, type RegistroPonte } from '@/lib/ponte-richieste'

// IL TETTO DI DURATA, che qui non c'era.
// Oltre la chiamata d'ordine il pacco e' COMPRATO: se la funzione viene uccisa fra l'ordine e la
// riga su spedizioni, il fornitore ha incassato e a sistema non resta niente — nessuna spedizione,
// nessun movimento, un 504 a chi integra, che ritenta e compra un secondo pacco. E' peggio di un
// numero provvisorio, che almeno resta registrato e recuperabile. Alzando l'attesa della lettera di
// vettura la coda misurata arriva a 10-22 secondi: senza un tetto dichiarato si andava a sbattere.
// 120 e non 60 per il PONTE DI CONDIVISIONE: questa rotta chiama se stessa un salto piu' in basso
// (Wave → LOGIXIA) e ogni salto deve lasciare tempo a quello sotto (lib/moovexpress, PONTE_HDR_TEMPO).
// Con 60 a due salti il 9/11/2026 il database lento bastava a far morire chi stava sopra mentre la LDV
// nasceva sotto. Il tetto vero di ogni richiesta del ponte e' la scadenza che le passa chi la chiama.
export const maxDuration = 120

// GET /api/v1/shipments — elenca le spedizioni del cliente della API key (paginata).
// Molti client "testano il collegamento" con una GET qui: senza questa si otteneva 405.
export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const admin = createAdminSupabase()
  const url = new URL(req.url)
  // ?richiesta=<codice>: com'e' finita una creazione del ponte di cui il compratore non ha avuto la
  // risposta (lib/ponte-richieste). Solo le richieste di questa chiave.
  if (url.searchParams.has('richiesta')) {
    const codice = codiceRichiestaValido(url.searchParams.get('richiesta'))
    if (!codice) return NextResponse.json({ error: 'Codice richiesta non valido' }, { status: 400 })
    try {
      const r = await leggiRichiestaPonte(admin, codice, ctx.clienteId)
      return r ? NextResponse.json({ richiesta: r }) : NextResponse.json({ richiesta: null }, { status: 404 })
    } catch (e: any) {
      console.error('[PONTE][REGISTRO] lettura', codice, e?.message)
      return NextResponse.json({ error: 'Registro non leggibile in questo momento' }, { status: 503 })
    }
  }
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50') || 50))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0') || 0)
  const stato = url.searchParams.get('stato')
  let q = admin.from('spedizioni')
    // `rif_ordine` = il riferimento d'ordine di chi spedisce (quello che il portale mostra come
    // "Rif. Ordine"). Chiesto da chi si integra il 6/10/2026: leggevano tracking, destinatario e
    // stato ma non avevano modo di riagganciare la spedizione all'ordine del proprio gestionale, che
    // e' il primo motivo per cui si legge questa lista.
    .select('id,numero,tracking_number,rif_ordine,stato,dest_nome,dest_citta,dest_provincia,dest_cap,dest_paese,colli,peso_reale,contrassegno,costo_totale,created_at', { count: 'exact' })
    .eq('cliente_id', ctx.clienteId)
    // + id: con la sola data, le spedizioni importate in blocco (stesso created_at) cambiavano pagina fra
    // una richiesta e l'altra, e chi integra ne vedeva due volte alcune e mai altre.
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
  if (stato) q = q.eq('stato', stato)
  const { data, count } = await q
  return NextResponse.json({ shipments: data || [], count: count || 0, limit, offset })
}

// API pubblica MoovExpress — crea una spedizione sul contratto della API key.
// Auth: Authorization: Bearer <api_key>
// Body: { packages:[{weight,length,width,height}], shipFrom:{...}, shipTo:{...}, codValue?, insuranceValue?, notes?, contenuto?,
//         incassoModalita?: 'C'|'AB'|'AC' (contanti / assegno bancario / circolare: GLS e SDA EXPRESS L),
//         pickup?: { requested: true, date: 'AAAA-MM-GG', time?: 'mattina'|'pomeriggio' } }
// Sui contratti Poste la risposta dice come si incassera' il contrassegno: `codMode: 'CON'|'ABM'|'ACM'`.
// Il RITIRO va chiesto QUI: su alcuni contratti si prenota solo insieme all'ordine e non si puo'
// aggiungere dopo — /api/v1/pickups per quei contratti risponde 400 apposta. Se il ritiro e' stato
// chiesto, la risposta contiene `ritiro: { richiesto, data, intervallo, codice, avviso? }`, dove
// richiesto=true vuol dire prenotato; sugli altri contratti richiesto=false e l'avviso dice come fare.
//
// Se la chiamata arriva da un ponte di condivisione (PONTE_HDR_RICHIESTA), com'e' finita si scrive nel
// registro (lib/ponte-richieste) quando la risposta e' pronta, qualunque strada abbia preso la rotta:
// e' quello che il compratore legge se la risposta non gli arriva.
export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const reg: RegistroPonte = { codice: null, aperta: false }
  // Cronometro (lib/cronometro): come per la creazione dal portale, una riga [V1][TEMPI] per creazione. Serve
  // soprattutto ai contratti condivisi: il ponte crea qui presso il master a monte, e questa rotta pesa 5,6 s
  // (mediana, 20/11/2026) dentro i 7-10 s della loro creazione. Misura soltanto.
  const res = await cronometra('[V1][TEMPI]', async () => {
    // Memoria della richiesta (lib/memo-richiesta): come nella creazione dal portale.
    const r = await conMemoRichiesta(() => creaSpedizioneApi(req, t0, reg))
    annota('stato', r.status)
    return r
  })
  if (reg.aperta && reg.codice) await chiudiRichiestaPonte(createAdminSupabase(), reg.codice, res)
  return res
}

async function creaSpedizioneApi(req: NextRequest, t0: number, reg: RegistroPonte): Promise<Response> {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()
  // Fino a quando questa richiesta puo' lavorare: se arriva da un ponte, quanto resta a chi l'ha chiamata.
  const scadenza = scadenzaRichiesta(req, t0, maxDuration)
  {
    const codice = codiceRichiestaValido(req.headers.get(PONTE_HDR_RICHIESTA))
    if (codice) {
      const aperta = await apriRichiestaPonte(admin, codice, ctx.clienteId)
      if (aperta === 'doppia') return NextResponse.json({ error: 'Richiesta già ricevuta: non ne è stata creata un\'altra.' }, { status: 409 })
      if (aperta === 'aperta') { reg.codice = codice; reg.aperta = true }
    }
  }

  // Controlli e prezzo di questo livello, fino al credito della catena compreso (lib/v1-livello): stessi passi,
  // stesso ordine, stesse risposte d'errore di quando stavano scritti qui.
  const v = await valutaLivelloV1(admin, ctx, body)
  if (v instanceof Response) return v
  const {
    cliente, masterId, corriere, cred, packages, pkg, pesoReale, pressoFrom, pressoTo, conPresso,
    _vuoleRitiro, _dataRitiro, _pomeriggio, _codicePunto, puntoConsegna, depositoTipo,
    _ritiroAlCorriere, _avvisoRitiroDeposito, ris, costoCliente,
  } = v

  // ── PRENOTAZIONE DEL CREDITO ─────────────────────────────────────────────────────
  // Prima qui si LEGGEVA il saldo e si addebitava solo a fine rotta, dopo la chiamata al corriere:
  // fra i due momenti passano secondi, e chiamate simultanee vedevano tutte credito capiente. Con
  // un'API si spara in parallelo senza fatica: bastava per comprare spedizioni vere andando a
  // credito negativo quanto si vuole, e a pagarle era il master — addebitaCatena scala comunque
  // tutta la catena.
  // Il portale aveva già risolto esattamente questo (app/api/spedizioni/crea): il credito si MUOVE
  // subito, con la capienza verificata dentro la stessa istruzione (blocco di riga), e a fine rotta
  // la prenotazione viene confermata sull'importo definitivo o stornata se la spedizione non nasce.
  // Le prenotazioni rimaste appese le libera /api/spedizioni/prenotazioni-scadute.
  let prenotazioneRif: string | null = null
  if (cliente.tipo_contratto === 'credito_scalare' && costoCliente > 0) {
    const rif = `PRE:${crypto.randomUUID()}`
    try {
      await registraMovimento(admin, {
        masterId, clienteId: ctx.clienteId, tipo: 'spedizione',
        descrizione: `Prenotazione ${String(body.shipTo?.name || '').slice(0, 40)}`.trim(),
        riferimento: rif, importo: -Math.abs(costoCliente), createdBy: null, richiediCapienza: true,
      })
      prenotazioneRif = rif
    } catch (e: any) {
      if (String(e?.message || '').includes('CREDITO_INSUFFICIENTE')) {
        const { data: cAgg } = await admin.from('clienti').select('credito').eq('id', ctx.clienteId).maybeSingle()
        return NextResponse.json({ error: `Credito insufficiente: disponibili € ${Number((cAgg as any)?.credito || 0).toFixed(2)}, spedizione € ${costoCliente.toFixed(2)}` }, { status: 402 })
      }
      console.error('[V1][PRENOTAZIONE] fallita, si prosegue con l addebito a fine rotta:', e?.message)
    }
  }
  // Libera la prenotazione quando la spedizione NON nasce. Idempotente.
  async function stornaPrenotazione() {
    if (!prenotazioneRif) return
    const rif = prenotazioneRif; prenotazioneRif = null
    try { await admin.rpc('storna_prenotazione_spedizione', { p_riferimento: rif }) }
    catch (e: any) { console.error('[V1][STORNO PRENOTAZIONE]', rif, e?.message) }
  }
  // Errore dopo la prenotazione: prima si restituisce il credito, poi si risponde.
  async function errore(messaggio: string, stato = 400) {
    await stornaPrenotazione()
    return NextResponse.json({ error: messaggio }, { status: stato })
  }

  let numero = '', costoCorrente = 0, etichettaUrl: string | null = null, raw: any = null
  // Il codice del ritiro prenotato dal corriere: va restituito a chi integra, come fa il portale.
  let codiceRitiro: string | null = null
  // Come il corriere incassera' il contrassegno (CON / ABM / ACM): solo dove finisce su un contratto Poste.
  let codModeUsata: ModalitaCod | null = null
  // Se il ritiro chiesto e' PARTITO davvero verso il corriere. Lo accendono solo i rami che lo
  // prenotano (easyparcel dentro l'ordine, ponte se il venditore conferma): prima la risposta diceva
  // richiesto:true su ogni contratto, anche dove non si prenotava niente (vedi lib/ritiro-api).
  let ritiroPrenotato = false
  // MULTICOLLO: l'etichetta di OGNI collo. Il portale la salva qui e la label route la unisce; questa
  // porta invece salvava solo il primo collo -> chi stampa da API riceveva una etichetta sola su un
  // pacco da N colli. Resta null sul mono-collo e su spediamopro (che gia' consegna il PDF unito).
  let colliDettaglio: any[] | null = null
  // GLS: quante etichette di collo mancano alla creazione (GLS genera i PDF con un attimo di ritardo).
  // Se ne manca anche una sola, dopo l'insert si riprendono in background (vedi sotto l'insert).
  let glsColliSenzaEtichetta = 0
  // Il locker InPost scelto: InPost lo riceve cosi' com'e', qui serve solo a dirlo nella risposta.
  let puntoInpostScelto: string | null = null

  // PONTE: se a chi ci ha chiamato resta troppo poco tempo, il corriere non si chiama. La LDV nascerebbe
  // quando chi la aspettava e' gia' morto, e resterebbe addebitata senza la spedizione del cliente
  // (282343J064551, 9/11/2026: prenotazione alle 12:20:54, chi chiamava e' morto alle 12:20:55, LDV alle
  // 12:20:58). Senza ponte la scadenza e' il tetto di questa rotta, e qui non si arriva mai cosi' tardi.
  if (scadenza - Date.now() < MINIMO_CREAZIONE_MS) {
    console.error('[V1][PONTE] tempo finito prima del corriere', { contratto: corriere.nome_contratto, restano_ms: scadenza - Date.now() })
    // 400 e non 5xx: e' un no sicuro (il corriere non e' stato chiamato), e chi chiama non deve verificare.
    return errore(MSG_PONTE_NON_CONCLUSO, 400)
  }

  if (corriere.tipo === 'spedisci') {
    const baseUrl = `https://${cred.master_domain}/api/v2`
    // Spedisci ha la seconda riga indirizzo nativa: ci mappiamo il "presso".
    const spedFrom = { ...body.shipFrom, street2: pressoFrom }
    const spedTo = { ...body.shipTo, street2: pressoTo }
    const ratesRes = await fetch(`${baseUrl}/shipping/rates`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages, shipFrom: { ...spedFrom, email: EMAIL_PER_CORRIERE }, shipTo: { ...spedTo, email: EMAIL_PER_CORRIERE }, notes: body.notes || '', insuranceValue: body.insuranceValue || 0, codValue: body.codValue || 0, accessoriServices: [] }),
    })
    const rates = await ratesRes.json()
    if (!Array.isArray(rates) || !rates.length) return errore('Nessuna tariffa dal corriere')
    // Sceglie la tariffa del CONTRATTO di questo corriere (non la prima): sullo stesso account
    // a valle possono coesistere più corrieri (GLS, Poste...) -> evita etichette col vettore sbagliato.
    const { trovaRateContratto } = await import('@/lib/spedisci')
    const rate = trovaRateContratto(rates, cred)
    if (!rate) return errore('Contratto non disponibile per questo corriere')
    const res = await fetch(`${baseUrl}/shipping/create`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
      // EMAIL SCHERMO: al provider va l'email di servizio, mai quelle vere (vedi lib/email-corriere).
      // Su Crono fanno eccezione: gli avvisi del corriere devono arrivare a mittente e destinatario.
      // Se l'email vera manca il campo non parte proprio: mai la nostra al posto della loro.
      body: JSON.stringify({ carrierCode: rate.carrierCode, contractCode: rate.contractCode, label_format: 'PDF', packages,
        shipFrom: { ...spedFrom, email: emailAlCorriere(corriere.nome_contratto, body.shipFrom?.email) },
        shipTo: { ...spedTo, email: emailAlCorriere(corriere.nome_contratto, body.shipTo?.email) },
        notes: body.notes || '', insuranceValue: body.insuranceValue || 0, codValue: body.codValue || 0, accessoriServices: [] }),
    })
    const text = await res.text(); try { raw = JSON.parse(text) } catch { raw = { error: text } }
    // erroreCorrierePulito: la risposta grezza del provider porta il suo nome e i suoi campi
    // interni, e da qui finiva dritta a chi si integra con l'API. Il portale la ripuliva gia'.
    if (!res.ok || raw.error) return errore(erroreCorrierePulito(raw?.error || text))
    numero = raw.trackingNumber; costoCorrente = parseFloat(raw.shipmentCost) || 0
    // MULTICOLLO: il provider torna una etichetta per collo in raw.labels; su mono-collo un solo
    // labelData. Come il portale: si tiene la prima come principale e si salva OGNI collo in
    // colli_dettaglio, cosi' la label route (leggiEtichettaCompleta) le unisce tutte. Prima si
    // prendeva solo labels[0] e chi stampava da API riceveva un'etichetta sola su un multicollo.
    let etichetteUrls: string[] = []
    if (Array.isArray(raw.labels) && raw.labels.length) {
      etichetteUrls = raw.labels.map((l: any) => l.labelData ? `data:application/pdf;base64,${l.labelData}` : (l.url || '')).filter(Boolean)
    }
    // Principale: la prima per-collo se il provider le ha separate, altrimenti il PDF unico — che su
    // questo provider e' GIA' multipagina (un collo per pagina), verificato sulle spedizioni reali.
    etichettaUrl = etichetteUrls[0] || (raw.labelData ? `data:application/pdf;base64,${raw.labelData}` : null)
    // colli_dettaglio SOLO se il provider manda un'etichetta separata per collo (labels[] con piu' di
    // uno): cosi' la label route le unisce. Con il labelData unico multipagina NON si duplica per
    // collo (sarebbe lo stesso PDF N volte, spreco di disco): basta gia' etichetta_url.
    if (packages.length > 1 && etichetteUrls.length > 1) {
      colliDettaglio = packages.map((p: any, i: number) => ({
        numero: i + 1, lunghezza: p?.length || null, larghezza: p?.width || null, altezza: p?.height || null, peso: p?.weight || null,
        etichetta_url: etichetteUrls[i] || etichetteUrls[0] || null,
      }))
    }
    // Salvo carrier/contract usati: servono al RITIRO (pickup/create li rilegge da raw_response). Senza, la spedizione non è ritirabile.
    // Niente copia del PDF dentro raw_response: e' gia' in etichetta_url (vedi crea/route.ts).
    raw = { ...raw, labelData: undefined, labels: undefined, _carrierCode: rate.carrierCode, _contractCode: rate.contractCode }
  } else if (corriere.tipo === 'spediamopro') {
    // Telefono destinatario obbligatorio per SpediamoPro (serve alla consegna): errore chiaro invece
    // del tecnico "consignee.phone should be of type string".
    if (!telValidoSp(body.shipTo?.phone)) {
      return errore('Telefono destinatario obbligatorio e non valido (solo cifre, 6–15): il corriere lo richiede per la consegna.')
    }
    // Il corriere non ha una seconda riga indirizzo. L'indirizzo si costruisce tenendo SEMPRE il
    // civico: BRT stampa ~21 caratteri della riga, Poste ~35, quindi si accorcia la via (Via->V. ecc.)
    // preservando il numero civico invece di tagliare in coda (dove il civico sparirebbe). Il presso
    // entra solo se resta spazio. Vedi indirizzoEtichetta.
    const maxAddr = /brt/i.test(corriere.nome_contratto || '') ? 21 : 35
    const sender = { name: body.shipFrom.name?.substring(0,35), address: indirizzoEtichetta(body.shipFrom.street1 || '', pressoFrom, maxAddr), postalCode: body.shipFrom.postalCode, city: body.shipFrom.city?.substring(0,35), province: body.shipFrom.state?.substring(0,2).toUpperCase(), country: 'IT', phone: body.shipFrom.phone || undefined, email: body.shipFrom.email?.substring(0,50) || undefined }
    const consignee: any = { name: body.shipTo.name?.substring(0,35), address: indirizzoEtichetta(body.shipTo.street1 || '', pressoTo, maxAddr), postalCode: body.shipTo.postalCode, city: body.shipTo.city?.substring(0,35), province: body.shipTo.state?.substring(0,2).toUpperCase(), country: (body.shipTo.country||'IT').toUpperCase() }
    if (body.shipTo.phone) consignee.phone = body.shipTo.phone
    if (body.shipTo.email) consignee.email = body.shipTo.email.substring(0,50)
    // CONSEGNA A UN PUNTO (Fermopoint / Locker): come il portale, l'indirizzo per preventivo ed
    // etichetta e' quello del PUNTO; nome e contatti restano del destinatario vero, che ritira e
    // riceve per email il codice (verificata sopra).
    if (puntoConsegna) {
      if (puntoConsegna.address) consignee.address = String(puntoConsegna.address).substring(0, 35)
      if (puntoConsegna.postalCode) consignee.postalCode = puntoConsegna.postalCode
      if (puntoConsegna.city) consignee.city = String(puntoConsegna.city).substring(0, 35)
      if (puntoConsegna.province) consignee.province = String(puntoConsegna.province).substring(0, 2).toUpperCase()
      consignee.email = String(body.shipTo?.email || '').trim().substring(0, 50)
    }
    // MULTICOLLO: un parcel per OGNI collo (prima si inviava un solo parcel col peso totale).
    const parcels = packages.map((p: any) => ({ weight: kgToGrams(parseFloat(p?.weight)||1), length: cmToMm(p?.length||10), width: cmToMm(p?.width||10), height: cmToMm(p?.height||10) }))
    // GUARDIA DIMENSIONI LOCKER S (gemella del portale, vedi crea/route.ts): il costo InPost dipende
    // dalla TAGLIA del locker (misure), il listino e' a peso e non la conosce -> un pacco fuori misura
    // finisce in un locker piu' grande, costa di piu' ma verrebbe venduto a tariffa Locker S (sotto costo).
    // Limite misurato via API: entra un collo fino a 64x38x19 cm. Se un collo non ci sta -> si ferma.
    if (/\blocker\s*s\b/i.test(String(corriere.nome_contratto || ''))) {
      const LOCKER_S_MM = [190, 380, 640]   // 19x38x64 cm, lato corto->lungo
      const fuori = parcels.find((p: any) => {
        const d = [p.length, p.width, p.height].sort((a: number, b: number) => a - b)
        return d[0] > LOCKER_S_MM[0] || d[1] > LOCKER_S_MM[1] || d[2] > LOCKER_S_MM[2]
      })
      if (fuori) {
        await stornaPrenotazione()
        const cm = (mm: number) => Math.round(mm / 10)
        return NextResponse.json({ error: `Pacco troppo grande per InPost Locker S (max 64x38x19 cm): ${cm(fuori.length)}x${cm(fuori.width)}x${cm(fuori.height)} cm. Scegli un altro corriere o riduci le misure.` }, { status: 400 })
      }
    }
    const cod = body.codValue ? euroToCents(body.codValue) : undefined
    const ins = body.insuranceValue ? euroToCents(body.insuranceValue) : undefined
    // BRT ha due service BRTEXP: quale sia disponibile dipende da peso/misure e colli. Se il
    // contratto ne ha un secondo, li passo SEMPRE entrambi e SpediamoPro sceglie il tier giusto.
    const serviceIdV1 = cred.service_id_multicollo
      ? [cred.service_id, cred.service_id_multicollo].filter(Boolean).join(',')
      : (cred.service_id || null)
    // try/catch come negli altri due rami: le librerie del provider lanciano eccezioni per le
    // cause piu' banali (indirizzo rifiutato, contrassegno non previsto, nessuna tariffa) e
    // senza cattura diventavano un 500 muto, con la prenotazione del credito appesa.
    try {
      const quotation = await spediamoproGetQuotation(cred.authcode, serviceIdV1, { parcels, sender, consignee, cashOnDeliveryAmount: cod, insuredAmount: ins })
      const externalRefV1 = (body.notes ? String(body.notes) : '').substring(0, 64) || undefined
      // La NOTA del cliente va al riquadro NOTE dell'etichetta del corriere (come fa il portale), non
      // solo nel Riferimento. Il campo NOTE di SpediamoPro e' max ~20 char (oltre = 422): si tronca; i
      // caratteri li normalizza la lib. Regola: se scrivono in note, deve arrivare in note.
      const noteEtichettaV1 = body.notes ? String(body.notes).trim().substring(0, 20) : undefined
      const shipment = await spediamoproCreateShipment(cred.authcode, {
        parcels, sender, consignee, quotation, cashOnDeliveryAmount: cod, insuredAmount: ins, externalReference: externalRefV1, notes: noteEtichettaV1,
        ...(puntoConsegna ? { deliveryPudo: puntoConsegna.code } : {}),
      })
      let trk = shipment.trackingCode; if (!trk) trk = await spediamoproWaitForTracking(cred.authcode, shipment.id)
      numero = trk || shipment.code || `SP-${shipment.id}`; costoCorrente = centsToEuro(shipment.totalPrice)
      // ZIP multicollo → PDF unico; PDF/immagini mono-collo invariati. Se non pronta, resta null (riscaricata on-demand).
      try { const lb = await spediamoproGetLabel(cred.authcode, shipment.id); const norm = await normalizzaEtichetta(lb); etichettaUrl = `data:${norm.mime};base64,${norm.buffer.toString('base64')}` } catch {}
      raw = { ...shipment, _quotation: quotation }
    } catch (e: any) {
      console.error('[V1][SPEDIAMOPRO]', e?.message)
      return errore(erroreCorrierePulito(e?.message))
    }
  } else if (corriere.tipo === 'easyparcel') {
    // Tre passi obbligati (preventivo → ordine → lettera di vettura) e NESSUN annullo disponibile:
    // per questo tutti i controlli stanno prima dell'ordine. Vedi lib/easyparcel.ts.
    const { easyparcelQuotation, easyparcelOrder, easyparcelWaybill, trovaOffertaVettore, erroreEasyparcelPulito, ritiroEasyparcel, preparaDoganaEasyparcel } = await import('@/lib/easyparcel')
    const apikey = String(cred?.apikey || ''), vettore = String(cred?.vettore || '')
    if (!apikey || !vettore) return errore('Contratto non configurato correttamente')
    // Chiave di prova: l'ordine riesce ma il pacco non esiste. Dall'API pubblica spedisce sempre
    // un cliente, quindi qui il blocco e' secco (vedi la stessa nota in spedizioni/crea).
    if (String(cred?.ambiente || '').toLowerCase() === 'demo') return errore('Questo contratto è ancora in configurazione e non può essere usato per spedizioni reali')
    // Cellulare di mittente e destinatario: il corriere li rifiuta se mancanti.
    const solaCifre = (v: any) => String(v || '').replace(/[^0-9]/g, '')
    const cellM = solaCifre(body.shipFrom?.phone), cellD = solaCifre(body.shipTo?.phone)
    if (cellM.length < 6) return errore('Telefono mittente obbligatorio per questo contratto (solo cifre, minimo 6)')
    if (cellD.length < 6) return errore('Telefono destinatario obbligatorio per questo contratto (solo cifre, minimo 6)')
    try {
      const quoteArgs = {
        colli: packages.map((p: any) => ({ peso: parseFloat(p?.weight) || 1, larghezza: parseFloat(p?.width) || 10, profondita: parseFloat(p?.length) || 10, altezza: parseFloat(p?.height) || 10 })),
        mittente: { cap: body.shipFrom.postalCode, localita: body.shipFrom.city, provincia: body.shipFrom.state, nazione: 'IT' },
        // Consegna a un PUNTO: il preventivo vuole la localita' del PUNTO (con quella di casa, o vuota,
        // per questi servizi non torna l'offerta). Come il portale. Serve solo al codice offerta: il
        // prezzo al cliente resta il nostro listino.
        destinatario: puntoConsegna
          ? { cap: puntoConsegna.postalCode, localita: puntoConsegna.city || body.shipTo.city, provincia: puntoConsegna.province || body.shipTo.state, nazione: (body.shipTo.country || 'IT').toUpperCase() }
          : { cap: body.shipTo.postalCode, localita: body.shipTo.city, provincia: body.shipTo.state, nazione: (body.shipTo.country || 'IT').toUpperCase() },
        contenuto: body.contenuto, contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
      }
      const offerte = await easyparcelQuotation(apikey, quoteArgs)
      const servizio = String(cred?.consegna || '')
      let offerta = trovaOffertaVettore(offerte, vettore, servizio)
      if (!offerta) {
        // Merce pesante per collo = PALLET per DVA: 'M' torna solo i corrieri pacchi-pesanti senza
        // errore -98, quindi l'offerta pallet del contratto scelto sta solo sotto 'P'. Riprovo pallet.
        const offertePallet = await easyparcelQuotation(apikey, { ...quoteArgs, cosaSpedire: 'P' })
        offerta = trovaOffertaVettore(offertePallet, vettore, servizio)
      }
      if (!offerta) return errore('Nessuna tariffa disponibile per questa destinazione con il contratto scelto')
      const opz = offerta.serviziopzionali || {}
      const codReq = Number(body.codValue || 0) > 0, assReq = Number(body.insuranceValue || 0) > 0
      if (codReq && String(opz?.contrassegno?.attivabile || 'N').toUpperCase() !== 'S') return errore('Contrassegno non disponibile su questo contratto per questa destinazione')
      if (assReq && String(opz?.assicurazione?.attivabile || 'N').toUpperCase() !== 'S') return errore('Assicurazione non disponibile su questo contratto per questa destinazione')
      // RITIRO: su questi contratti si prenota SOLO qui — il corriere non ha una chiamata per
      // aggiungerlo dopo, e infatti /api/ritiri/crea lo rifiuta di proposito. Il portale il ritiro
      // lo legge e lo manda da sempre; questa rotta non leggeva NESSUN campo di ritiro, quindi
      // qualunque cosa mandasse chi integra veniva ignorata in silenzio, con 200 OK e la spedizione
      // creata. Misurato: 48 spedizioni da questa porta, ZERO col ritiro; dal portale, sullo stesso
      // tipo di contratto, il ritiro viene chiesto sul 28,6% (348 su 1216). E non e' rimediabile
      // dopo: quei pacchi vanno portati a mano in filiale.
      // DOGANA (solo estero): senza codici HS/TARIC i corrieri internazionali rifiutano l'ordine, e
      // questo provider non ha annullo. Si prepara PRIMA di comprare e si blocca qui se mancano i dati.
      let dogana
      try {
        // Righe doganali per-articolo dal partner (facoltative): una voce hscode per articolo. Se
        // incomplete, preparaDoganaEasyparcel ripiega sulla voce aggregata (contenuto/valore/hscode).
        const customsItems = Array.isArray(body.customsItems) ? body.customsItems.map((it: any) => ({
          hscode: it?.hscode ?? it?.hsCode, descrizione: it?.description ?? it?.descrizione,
          quantita: Number(it?.quantity ?? it?.quantita) || 1,
          valoreUnitario: Number(it?.unitValue ?? it?.value ?? it?.valore) || 0,
          peso: Number(it?.weight ?? it?.peso) || 0, origine: it?.origin ?? it?.origine,
        })) : undefined
        dogana = await preparaDoganaEasyparcel(apikey, {
          estero: String(body.shipTo.country || 'IT').toUpperCase() !== 'IT',
          contenuto: body.contenuto,
          valore: Number(body.valoreMerce ?? body.declaredValue ?? body.insuranceValue ?? 0),
          peso: packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0),
          nrColli: packages.length,
          hscode: body.hscode, origine: body.origineMerce,
          articoli: customsItems,
        })
      } catch (e: any) {
        return errore(String(e?.message || 'Dati doganali mancanti per la spedizione internazionale'))
      }
      // Estero: al destinatario va la SUA email vera (serve al corriere/dogana per lo sdoganamento),
      // con ripiego sull'email di servizio se manca; sul nazionale resta l'email di servizio (stessa
      // scelta del portale, vedi memoria "email schermo corriere").
      const esteroDest = String(body.shipTo.country || 'IT').toUpperCase() !== 'IT'
      // Consegna a un PUNTO: l'avviso di giacenza / il codice di ritiro lo manda il CORRIERE al
      // destinatario, quindi gli serve l'email vera (come il portale; ripiego su quella di servizio).
      const emailDest = (esteroDest || puntoConsegna) ? (String(body.shipTo?.email || '').trim() || EMAIL_PER_CORRIERE) : EMAIL_PER_CORRIERE
      // Consegna a un PUNTO: sull'etichetta l'indirizzo e' quello del punto, la via di casa non serve.
      // Stessa forma del portale ("nome - via - CAP localita'").
      const indirizzoDest = puntoConsegna
        ? [puntoConsegna.name, puntoConsegna.address, [puntoConsegna.postalCode, puntoConsegna.city].filter(Boolean).join(' ')].filter(Boolean).join(' - ').slice(0, 100)
        : conPresso(body.shipTo.street1 || '', pressoTo)
      const ordine = await easyparcelOrder(apikey, {
        codiceOfferta: String(offerta.codice_offerta),
        ...(_ritiroAlCorriere ? { ritiro: ritiroEasyparcel(_dataRitiro, _pomeriggio) } : {}),
        // Il "presso" non ha un campo dedicato: si accoda all'indirizzo, come per l'altro provider.
        mittente: { nominativo: body.shipFrom.name, indirizzo: conPresso(body.shipFrom.street1 || '', pressoFrom), email: EMAIL_PER_CORRIERE, cellulare: cellM, contatto: body.shipFrom.name },
        destinatario: { nominativo: body.shipTo.name, indirizzo: indirizzoDest, email: emailDest, cellulare: cellD, contatto: body.shipTo.name },
        note: body.notes || undefined,
        contrassegno: codReq, assicurazione: assReq,
        ...(dogana ? { dogana } : {}),
        // PuntoPoste: dove deposita il mittente (TIPO di sportello) e il punto preciso di consegna.
        ...(depositoTipo ? { pudoMittente: depositoTipo } : {}),
        ...(puntoConsegna ? { pudoDestinatario: puntoConsegna.code } : {}),
      })
      // Ordine accettato col blocco ritiro dentro: il ritiro e' prenotato, anche se il codice arriva dopo.
      if (_ritiroAlCorriere) ritiroPrenotato = true
      let ldv: string | null = null
      // IL DETTAGLIO DEI COLLI SI SALVA SUBITO, come fa il portale (app/api/spedizioni/crea), anche se la lettera di
      // vettura non e' ancora pronta. Prima si scriveva solo con le etichette in mano: col numero provvisorio i pesi dei
      // colli andavano persi e il recupero delle etichette metteva a ogni collo le misure della spedizione. 3UW1WLJ114071
      // (CONTORNO, 18/11/2026): mandati 10 kg 50x30x35 + 20 kg 40x2x37, da noi due colli 50x30x35 senza peso, e la
      // spedizione pagata su 30,5 kg (fascia 30-50) non si spiegava. Le etichette le aggiungono poi tmp-completa e
      // tmp-recupero collo per collo, lasciando peso e misure.
      if (packages.length > 1) {
        colliDettaglio = packages.map((p: any, i: number) => ({
          numero: i + 1, lunghezza: p?.length || null, larghezza: p?.width || null, altezza: p?.height || null, peso: p?.weight || null,
          etichetta_url: null,
        }))
      }
      try {
        // QUANTO SI ASPETTA LA LETTERA DI VETTURA.
        // Su questo fornitore il numero non torna insieme all'ordine: se entro l'attesa non c'e', la
        // spedizione nasce con un numero provvisorio "TMP-...", senza etichetta, e il pacco non
        // parte. Il portale aspetta 8 x 1200 ms, e nel suo commento c'e' la misura fatta in
        // produzione: con otto tentativi il provvisorio tocca 8 spedizioni su 17, con due 15 su 16.
        // Qui erano rimasti 2 x 1500 — la correzione era stata fatta su una porta sola, e su questa
        // NESSUNA delle 48 spedizioni ha preso il numero al primo colpo.
        // Budget ~18s: come nella creazione dal portale, evita il timeout a 60s durante i rallentamenti
        // DVA (rischio ordine orfano). Si esce col provvisorio e la LDV la prende il recupero/background.
        const w = await easyparcelWaybill(apikey, ordine.idOrdine, _ritiroAlCorriere ? 6 : 8, 1200, _ritiroAlCorriere, 18000, packages.length)
        ldv = w.numero || null
        codiceRitiro = w.codiceRitiro || null
        // MULTICOLLO: il provider torna una etichetta per collo in w.singole. Come il portale: si
        // uniscono tutte nel PDF principale E si salva OGNI collo in colli_dettaglio, cosi' la label
        // route le rende tutte. Prima si prendeva solo singole[0] -> su un multicollo usciva una
        // etichetta sola (poi il cron recuperaMulticollo la sanava, ma solo dopo, non alla stampa).
        const singole = (w.singole || []).filter((s: any) => s?.pdfBase64)
        const etichettePerCollo = singole.map((s: any) => `data:application/pdf;base64,${s.pdfBase64}`)
        const { unisciEtichette } = await import('@/lib/easyparcel')
        const b64 = (await unisciEtichette(singole.map((s: any) => s.pdfBase64))) || w.pdfBase64
        if (b64) etichettaUrl = `data:application/pdf;base64,${b64}`
        if (packages.length > 1) {
          colliDettaglio = packages.map((p: any, i: number) => ({
            numero: i + 1, lunghezza: p?.length || null, larghezza: p?.width || null, altezza: p?.height || null, peso: p?.weight || null,
            // Se il provider ne manda meno dei colli si lascia null: un'etichetta vuota si vede, una ripetuta inganna.
            etichetta_url: etichettePerCollo[i] || null,
          }))
        }
      } catch (e: any) {
        // NON MUTO. Il progetto misura questo guasto contando "waybill non pronta" nei log, e qui
        // il catch vuoto rendeva la misura cieca proprio sulla porta che sbagliava di piu': per
        // questo il difetto e' rimasto invisibile pur essendo gia' noto e gia' corretto altrove.
        console.error('[V1][EASYPARCEL] waybill non pronta, ordine', ordine.idOrdine, e?.message)
      }
      numero = ldv || `TMP-${ordine.idOrdine}`
      costoCorrente = ordine.importo
      raw = { ...ordine, _codiceOfferta: String(offerta.codice_offerta), _vettore: vettore, _idOrdine: ordine.idOrdine, _codiceRitiro: codiceRitiro }
    } catch (e: any) {
      console.error('[V1][EASYPARCEL]', e?.codice ?? '-', e?.message, e?.dettagli || '')
      return errore(erroreEasyparcelPulito(e))
    }
  } else if (corriere.tipo === 'dielle') {
    // Dielle/TWS: diretto (costoCorrente=0, come i diretti). Il corriere reale è nel `servizio` (settings).
    // Etichetta con chiamata separata. NB: niente annullo via API (solo portale) → su insertError, come
    // gli altri, si risponde col numero e la LDV va annullata a mano dal portale del fornitore.
    const credDl = { username: cred.username, password: cred.password, ambiente: (cred.ambiente === 'prod' ? 'prod' : 'staging') as 'prod' | 'staging' }
    const settingsDl = (corriere as any)?.settings || {}
    const servizioDl = String(settingsDl.servizio || '').trim()
    if (!credDl.username || !credDl.password || !servizioDl) return errore('Contratto non configurato correttamente')
    try {
      const { creaSpedizioneDielle, etichettaDielle } = await import('@/lib/dielle')
      const risDl = await creaSpedizioneDielle(credDl, {
        servizio: servizioDl,
        codiceServizio: settingsDl.codiceServizio ? String(settingsDl.codiceServizio) : undefined,
        accessorioCrono: settingsDl.accessorio_crono ? String(settingsDl.accessorio_crono) : undefined,
        mittente: { ragione_sociale: body.shipFrom.name, indirizzo: conPresso(body.shipFrom.street1 || '', pressoFrom), comune: body.shipFrom.city, cap: body.shipFrom.postalCode, provincia: body.shipFrom.state, nazione: 'IT', telefono: body.shipFrom.phone || undefined, email: body.shipFrom.email || undefined },
        destinatario: { ragione_sociale: body.shipTo.name, indirizzo: conPresso(body.shipTo.street1 || '', pressoTo), comune: body.shipTo.city, cap: body.shipTo.postalCode, provincia: body.shipTo.state, nazione: body.shipTo.country || 'IT', telefono: body.shipTo.phone || undefined, email: body.shipTo.email || undefined },
        colli: packages.map((p: any) => ({ altezza: parseFloat(p?.height) || undefined, larghezza: parseFloat(p?.width) || undefined, profondita: parseFloat(p?.length) || undefined, peso: parseFloat(p?.weight) || 1 })),
        contrassegno: body.codValue ? Number(body.codValue) : undefined,
        tipoPagamento: body.codValue ? 'WITH' : undefined,
        assicurata: body.insuranceValue ? Number(body.insuranceValue) : undefined,
        note: body.notes ? String(body.notes) : undefined,
        numeroOrdine: (body.rifOrdine ? String(body.rifOrdine) : '').trim() || undefined,
        // Dogana fuori UE e locker InPost: i controlli stanno in lib/dielle (preparaInsSpedDielle).
        contenuto: body.contenuto ? String(body.contenuto) : undefined,
        valoreMerce: Number(body.valoreMerce ?? body.declaredValue ?? 0) || undefined,
        codiceLocker: String(body.inpostPointId || body.pointId || '').trim() || undefined,
      })
      numero = risDl.ldv
      costoCorrente = 0
      try { const lab = await etichettaDielle(credDl, numero, 'pdf'); if (lab.bytes?.length) etichettaUrl = `data:application/pdf;base64,${lab.bytes.toString('base64')}` } catch (e) { console.error('[V1][DIELLE] etichetta:', (e as any)?.message) }
      raw = { _dielle: true, ldv: numero, ambiente: credDl.ambiente }
    } catch (e: any) {
      console.error('[V1][DIELLE]', e?.message)
      return errore(e?.dielle ? e.message : erroreCorrierePulito(e?.message))
    }
  } else if (corriere.tipo === 'ecosmos') {
    // ECOSMOS (corriere elettrico di Roma): diretto, contratto proprio del master (lib/ecosmos.ts). Una LDV
    // e un PDF per tutta la spedizione; il ritiro lo fa Ecosmos dal mittente, senza prenotazione. Il
    // "presso" va nelle note di consegna e non attaccato alla via: Ecosmos vuole via e civico separati.
    const credEc = { api_key: String(cred.api_key || '') }
    const servizioEc = String(((corriere as any)?.settings || {}).servizio || 'express_24h')
    if (!credEc.api_key) return errore('Contratto non configurato correttamente')
    try {
      const { creaSpedizioneEcosmos } = await import('@/lib/ecosmos')
      const noteEc = [pressoTo ? `Presso ${pressoTo}` : '', body.notes ? String(body.notes) : ''].filter(Boolean).join(' — ')
      const risEc = await creaSpedizioneEcosmos(credEc, {
        servizio: servizioEc, colli: packages.length, pesoKg: pesoReale,
        mittente: { nome: body.shipFrom.name, indirizzo: body.shipFrom.street1 || '', citta: body.shipFrom.city, cap: body.shipFrom.postalCode, provincia: body.shipFrom.state, telefono: body.shipFrom.phone || null, email: body.shipFrom.email || null },
        destinatario: { nome: body.shipTo.name, indirizzo: body.shipTo.street1 || '', citta: body.shipTo.city, cap: body.shipTo.postalCode, provincia: body.shipTo.state, telefono: body.shipTo.phone || null, email: body.shipTo.email || null },
        noteConsegna: noteEc || null,
        contenuto: body.contenuto ? String(body.contenuto) : null,
        contrassegno: Number(body.codValue || 0) || null,
        assicurazione: Number(body.insuranceValue || 0) || null,
        riferimento: (body.rifOrdine ? String(body.rifOrdine) : '').trim() || null,
        idempotenza: crypto.randomUUID(),
      })
      numero = risEc.numero
      costoCorrente = 0
      etichettaUrl = risEc.etichettaBase64 ? `data:application/pdf;base64,${risEc.etichettaBase64}` : null
      // Niente prezzo Ecosmos: e' il costo del master, non deve viaggiare con la spedizione.
      raw = { _ecosmos: true, numero, stato: risEc.stato, servizio: servizioEc, tracking_url: risEc.trackingUrl }
    } catch (e: any) {
      console.error('[V1][ECOSMOS]', e?.message)
      // Nessuna risposta, o risposta senza numero: la spedizione forse c'e'. Il credito non si restituisce alla cieca (lo
      // libera il giro delle prenotazioni scadute se davvero non c'e').
      if (e?.forseCreata) return NextResponse.json({ error: e.message }, { status: 502 })
      return errore(e?.ecosmos ? e.message : erroreCorrierePulito(e?.message))
    }
  } else if (corriere.tipo === 'poste') {
    // Il ramo Poste sta in lib/v1-poste (lo usa anche il ponte unico): stesso codice, stesse risposte.
    const po = await ldvPosteV1({ corriere, cred, body, packages, conPresso, pressoFrom, pressoTo })
    if ('errore' in po) return errore(po.errore)
    ;({ numero, costoCorrente, codModeUsata, etichettaUrl, raw } = po)
  } else if (corriere.tipo === 'inpost') {
    // INPOST diretto (Global API): diretto (costoCorrente=0). Creazione sincrona. Verso locker se il body
    // porta un pointId (inpostPointId/pointId), altrimenti a domicilio. Niente annullo via API.
    const credIp = { clientId: cred.clientId, secretId: cred.secretId, organizationId: cred.organizationId, ambiente: (cred.ambiente === 'prod' ? 'prod' : 'stage') as 'prod' | 'stage' }
    if (!credIp.clientId || !credIp.secretId || !credIp.organizationId) return errore('Contratto non configurato correttamente')
    if (Number(body.codValue || 0) > 0) return errore('InPost non gestisce il contrassegno')
    // Il MODO lo decide il CONTRATTO: locker = solo a locker (serve il punto), domicilio = solo a casa
    // (pointId ignorato). Coerente col portale, così l'API non manda un Domicilio a un locker o viceversa.
    const contrattoLocker = String((corriere as any)?.settings?.consegna || '') === 'locker'
    // deliveryPoint.code e' il campo di tutti i contratti a punto; inpostPointId/pointId restano per
    // chi si era gia' integrato col nome vecchio.
    const pointId = contrattoLocker ? (String(body.inpostPointId || body.pointId || _codicePunto || '').trim() || undefined) : undefined
    if (contrattoLocker && !pointId) return errore('Questo contratto InPost consegna solo a locker: indica il locker di destinazione (deliveryPoint.code, cercalo con GET /api/v1/delivery-points). Per il domicilio usa il contratto InPost Domicilio.')
    puntoInpostScelto = pointId || null
    try {
      const { creaSpedizioneInpost, etichettaInpost } = await import('@/lib/inpost')
      const risIp = await creaSpedizioneInpost(credIp, {
        mittente: { ragioneSociale: body.shipFrom.name, indirizzo: conPresso(body.shipFrom.street1 || '', pressoFrom), civico: body.shipFrom.streetNumber || '', citta: body.shipFrom.city, cap: body.shipFrom.postalCode, paese: 'IT', telefono: body.shipFrom.phone || undefined, email: body.shipFrom.email || undefined },
        destinatario: { ragioneSociale: body.shipTo.company || undefined, nome: body.shipTo.name, indirizzo: conPresso(body.shipTo.street1 || '', pressoTo), civico: body.shipTo.streetNumber || '', citta: body.shipTo.city, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT', telefono: body.shipTo.phone || undefined, email: body.shipTo.email || undefined },
        colli: packages.map((p: any) => ({ altezza: parseFloat(p?.height) || undefined, larghezza: parseFloat(p?.width) || undefined, profondita: parseFloat(p?.length) || undefined, peso: parseFloat(p?.weight) || 1 })),
        pointIdDestinazione: pointId,
        reference: (body.rifOrdine ? String(body.rifOrdine) : '').trim() || undefined,
        note: body.notes ? String(body.notes) : undefined,
      })
      numero = risIp.trackingNumber
      costoCorrente = 0
      try { const lab = await etichettaInpost(credIp, numero, 'pdf'); if (lab.bytes?.length) etichettaUrl = `data:application/pdf;base64,${lab.bytes.toString('base64')}` } catch (e) { console.error('[V1][INPOST] etichetta:', (e as any)?.message) }
      raw = { _inpost: true, trackingNumber: numero, pointId: pointId || null, ambiente: credIp.ambiente }
    } catch (e: any) {
      console.error('[V1][INPOST]', e?.message)
      return errore(erroreCorrierePulito(e?.message))
    }
  } else if (corriere.tipo === 'gls') {
    // GLS DIRETTO: diretto (costoCorrente=0), come gli altri qui sopra. Da qui passano soprattutto i
    // contratti CONDIVISI tra reti: il compratore crea dal suo portale e il ponte chiama questa API del
    // venditore con la chiave del contratto. Il ramo non c'era: i tre GLS di Wave condivisi a MULTIEXPRESS
    // e QUICK il 06/11/2026 mostravano il prezzo ma rispondevano "Tipo contratto non supportato", e il
    // cliente MOI CHERI non poteva spedire (09/11).
    // La chiamata e' quella della creazione dal portale (app/api/spedizioni/crea, ramo GLS): contatti veri
    // del destinatario, contrassegno solo in ModalitaIncasso, Bda, Europa. A GLS la spedizione la trasmette
    // la chiusura di sera come tutte le GLS: legge il numero nudo da raw_response.numero, come tracking,
    // annullo e svincolo.
    const credGls = {
      sigla_sede: cred.sigla_sede, user_webservice: cred.user_webservice,
      password_webservice: cred.password_webservice, codice_contratto: cred.codice_contratto,
    }
    if (!credGls.sigla_sede || !credGls.user_webservice || !credGls.password_webservice) return errore('Contratto non configurato correttamente')
    try {
      const { creaSpedizioneGls, etichetteGls, servizioGls, bdaSpedizioneGls } = await import('@/lib/gls')
      // Riferimento (Bda): quello dell'ordine o uno univoco nostro, anche sul nazionale, come nel portale.
      // Senza, GLS univa due spedizioni allo stesso destinatario nella stessa giornata (lib/gls,
      // bdaSpedizioneGls). Sul Parcel e' obbligatorio e tiene 11 caratteri.
      const parcelGls = servizioGls((corriere as any).settings) === 'P'
      const bda = bdaSpedizioneGls(body.rifOrdine, parcelGls)
      const _im = String(body.incassoModalita || 'C')
      const modalitaIncassoGls = (_im === 'AB' || _im === 'A') ? 'AB' : _im === 'AC' ? 'AC' : 'CONT'
      const risGls = await creaSpedizioneGls(credGls, {
        ragioneSociale: body.shipTo.name,
        indirizzo: conPresso(body.shipTo.street1 || '', pressoTo),
        localita: body.shipTo.city,
        cap: body.shipTo.postalCode,
        provincia: body.shipTo.state,
        pesiColli: packages.map((p: any) => parseFloat(p?.weight) || 1),
        importoContrassegno: body.codValue ? Number(body.codValue) : undefined,
        modalitaIncasso: body.codValue ? modalitaIncassoGls : undefined,
        assicurazione: body.insuranceValue ? Number(body.insuranceValue) : undefined,
        note: body.notes ? String(body.notes) : undefined,
        bda,
        email: body.shipTo.email || undefined,
        cellulare: body.shipTo.phone || undefined,
        telefono: body.shipTo.phone || undefined,
        ...(parcelGls ? { tipoSpedizione: 'P' as const, paese: body.shipTo.country, personaRiferimento: body.shipTo.name } : {}),
      })
      if (!risGls.numeroSpedizione) {
        // Il motivo vero resta nei log, con le password coperte (come nel portale).
        console.error('[V1][GLS] create rifiutata', {
          contratto: corriere.nome_contratto,
          dest: `${body.shipTo?.postalCode || ''} ${body.shipTo?.city || ''} ${body.shipTo?.state || ''} ${body.shipTo?.country || ''}`.trim(),
          errore: risGls.errore,
          raw: String(risGls.raw || '').replace(/(Password\w*(?:&gt;|>))[^<&]*/gi, '$1***').slice(0, 400),
        })
        return errore(erroreCorrierePulito(risGls.errore || 'GLS: creazione non riuscita'))
      }
      numero = risGls.tracking || risGls.numeroSpedizione
      costoCorrente = 0
      raw = {
        _gls: true, numero: risGls.numeroSpedizione, tracking: numero, siglaMittente: risGls.siglaMittente,
        siglaSedeDestino: risGls.siglaSedeDestino, glsCheck: risGls.glsCheck, bda, ...(parcelGls ? { parcel: true } : {}),
      }
      // Un'etichetta per collo, unite in una per la spedizione. Mittente stampato: dove il contratto lo
      // chiede ci va quello vero e non l'intestatario del conto GLS (lib/etichetta-mittente).
      // Allineate ai colli (null = GLS non l'aveva ancora pronta): prima si scrivevano sui colli per
      // indice quelle arrivate, e col collo 2 non pronto l'etichetta del 3 finiva sul 2.
      let glsPerCollo: (string | null)[] = []
      glsColliSenzaEtichetta = risGls.numeroColli
      try {
        const { stampaMittenteSpedizione } = await import('@/lib/etichetta-mittente')
        const mittenteGls = (await stampaMittenteSpedizione(admin, corriere as any).catch(() => false))
          ? { nome: body.shipFrom?.name, destinatario: body.shipTo?.name } : null
        const et = await etichetteGls(credGls, risGls.numeroSpedizione, risGls.numeroColli, { bda, mittente: mittenteGls })
        glsPerCollo = et.perCollo
        glsColliSenzaEtichetta = et.mancanti.length
        if (et.etichette.length) {
          const { unisciEtichette } = await import('@/lib/easyparcel')
          const merged = await unisciEtichette(et.etichette)
          etichettaUrl = `data:application/pdf;base64,${merged || et.etichette[0]}`
        }
        if (et.mancanti.length) console.error('[V1][GLS] colli senza etichetta alla creazione:', numero, et.mancanti.join(','), 'di', risGls.numeroColli)
      } catch (e) { console.error('[V1][GLS] etichette:', (e as any)?.message) }
      // Il dettaglio colli c'e' sempre sul multicollo, anche coi colli ancora senza etichetta: e' li' che
      // il recupero (in background qui sotto, o alla stampa) aggiunge quelle che mancano.
      if (packages.length > 1) {
        colliDettaglio = packages.map((p: any, i: number) => ({
          numero: i + 1, lunghezza: p?.length || null, larghezza: p?.width || null, altezza: p?.height || null, peso: p?.weight || null,
          etichetta_url: glsPerCollo[i] ? `data:application/pdf;base64,${glsPerCollo[i]}` : null,
        }))
      }
    } catch (e: any) {
      console.error('[V1][GLS]', e?.message)
      return errore(erroreCorrierePulito(e?.message))
    }
  } else if (corriere.tipo === 'moovexpress') {
    // CONDIVISIONE CONTRATTI: provider a COSTO ESTERNO (W) — il corriere punta all'`/api/v1` del VENDITORE
    // con la api_key ricevuta all'Accetta. Diversamente dai diretti, costoCorrente = W (il prezzo che il
    // venditore addebita): la cascata lo usa come base del ricarico. A più salti funziona da sé (il venditore
    // può essere a sua volta compratore). È questa stessa porta a essere chiamata dal venditore un livello sotto.
    // CONDIVISIONE: chiave di dispatch dal PRIMO detentore-CODICE (via corrieri_condivisi), non dalla copia
    // colata nel ponte dell'originante. Invariante sui dati veri per i ponti attivi; chiude la fuga.
    const credMv = await risolviChiaveDispatch(admin, masterId, corriere.nome_contratto)
    if (!credMv?.api_key) return errore('Contratto non configurato correttamente')
    try {
      const { creaSpedizioneMoovexpress, etichettaMoovexpress } = await import('@/lib/moovexpress')
      const risMv = await creaSpedizioneMoovexpress(credMv, corpoPerIlVenditoreV1({ body, packages, conPresso, pressoFrom, pressoTo, _vuoleRitiro, _dataRitiro, _pomeriggio }), { scadenza })
      numero = risMv.tracking
      costoCorrente = risMv.prezzo   // W: costo esterno (come spedisci), NON 0
      codModeUsata = modalitaCodDaRichiesta(risMv.codMode)   // quella che il venditore ha davvero mandato
      codiceRitiro = risMv.ritiro?.codice || null
      // Prenotato solo se lo conferma il venditore: per SDA EXPRESS L la catena finisce su un contratto
      // Poste diretto, che alla creazione non prenota, e la sua risposta torna richiesto:false.
      ritiroPrenotato = _vuoleRitiro && risMv.ritiro?.richiesto === true
      // L'etichetta puo' aspettare solo finche' resta il tempo di scrivere la riga e addebitare: senza la
      // riga la LDV resterebbe orfana.
      try { const lab = await etichettaMoovexpress(credMv, risMv.label_url, { timeoutMs: scadenza - Date.now() - 12_000 }); if (lab.buffer.length) etichettaUrl = `data:${lab.mime};base64,${lab.buffer.toString('base64')}` } catch (e) { console.error('[V1][MOOVEXPRESS] etichetta:', (e as any)?.message) }
      // _ritiroPrenotato: sul ponte e' l'unico posto da cui il dettaglio (GET) puo' rileggerlo.
      raw = { _moovexpress: true, tracking: numero, venditore_spedizione_id: risMv.id || null, label_url: risMv.label_url || null, _ritiroPrenotato: ritiroPrenotato, _codiceRitiro: codiceRitiro }
    } catch (e: any) {
      console.error('[V1][MOOVEXPRESS]', e?.message)
      return errore(erroreCorrierePulito(e?.message))
    }
  } else {
    return errore('Tipo contratto non supportato')
  }

  // NUMERO UNICO PER IL LEDGER (condivisione contratti): `numero` ha un UNIQUE globale, ma nel ponte la
  // STESSA LDV viene registrata a OGNI livello (il venditore per il suo cliente-ledger, e il compratore
  // sopra). Se tutti usassero la LDV come `numero`, il 2° insert violerebbe l'unicità ("non registrata").
  // Quindi il LEDGER salva un numero unico (LDV + suo id); il `tracking_number` resta la LDV VERA (non è
  // unico, e serve condiviso: il tracking a salire interroga il venditore con quel numero). La LDV pulita
  // resta così libera per il compratore FINALE (master reale), che la vede come suo numero.
  // La riga e il suo numero: lib/v1-riga (li usa anche il ponte unico), stesso codice di quando stavano qui.
  const { numeroDb, riga } = rigaV1({
    cliente, ctx, numero, masterId, corriere, body, pressoFrom, pressoTo, puntoConsegna, packages, pesoReale, ris, pkg,
    codModeUsata, etichettaUrl, colliDettaglio, raw, costoCorrente, costoCliente, ritiroPrenotato, _dataRitiro, _pomeriggio,
  })
  const scriviRiga = () => admin.from('spedizioni').insert(riga).select('id').single()
  let inserted: any = null, insErr: any = null
  if (corriere.tipo === 'moovexpress' && numero) {
    // PONTE: la LDV dal venditore c'e' gia', quindi si riprova e si guarda se la riga e' gia' scritta
    // (lib/ponte-testa, regola di Lorenzo del 12/11/2026).
    const { scriviTestaPonte } = await import('@/lib/ponte-testa')
    const testa = await scriviTestaPonte(admin, scriviRiga, numeroDb, scadenza)
    if (testa.adottata) console.warn('[V1][MOOVEXPRESS][INSERT] riga gia\' scritta dal primo tentativo, adottata', numeroDb)
    if (testa.id) inserted = { id: testa.id }
    else insErr = { message: testa.errore || 'riga non scritta' }
  } else {
    const r = await scriviRiga()
    inserted = r.data; insErr = r.error
  }
  // PONTE: se la riga non si scrive, le gambe sotto si annullano adesso con lo storno, e il credito torna,
  // a chi integra e a ogni salto sopra (che riceve un 400). Solo se l'annullo e' riuscito davvero: con le
  // gambe ancora vive un nuovo tentativo comprerebbe una seconda LDV, quindi resta la risposta di sempre,
  // qui sotto, col numero.
  if (insErr && corriere.tipo === 'moovexpress' && numero) {
    const { annullaPaccoOrfano } = await import('@/lib/ponte-orfane')
    const chiuso = await annullaPaccoOrfano(admin, numero).catch(() => null)
    console.error('[V1][MOOVEXPRESS][INSERT]', numero, insErr.message, chiuso ? `gambe: ${chiuso.esito}${chiuso.motivo ? ' (' + chiuso.motivo + ')' : ''}` : 'pacco non verificato: nessun annullo')
    if (chiuso?.esito === 'annullata') return errore(MSG_PONTE_NON_REGISTRATA, 400)
  }
  // Qui NON si storna: il pacco dal corriere esiste gia' e va pagato. Il messaggio del database
  // (tabelle, colonne, vincoli) non esce: descrive la nostra struttura interna a chi si integra.
  // Eccezione GLS diretto, come nel portale: prima della chiusura di sera la spedizione non e' ancora
  // trasmessa, quindi si toglie da GLS e il credito torna. Solo se GLS conferma l'annullo.
  if (insErr && corriere.tipo === 'gls' && raw?.numero) {
    const { annullaSpedizioneGls, numeroGlsGiaNostro } = await import('@/lib/gls')
    // NUMERO GIA' NOSTRO: GLS ha messo il pacco dentro una spedizione che esiste gia' (stesso destinatario
    // e stesso riferimento). Annullarla la cancellava tutta, col pacco gia' etichettato (NI665655922,
    // 10/11/2026, dal portale). Non nasce niente di nuovo: il credito torna e quella spedizione resta.
    if (numeroGlsGiaNostro(insErr)) {
      console.error('[V1][GLS][INSERT] numero gia\' di una nostra spedizione, NON annullato su GLS', numero, insErr.message)
      return errore(`GLS ha unito questo pacco alla spedizione ${numero}, già creata per lo stesso destinatario con lo stesso riferimento ordine. Non è stata creata una spedizione nuova: contatta l'assistenza indicando ${numero}.`, 409)
    }
    const annullata = await annullaSpedizioneGls(cred as any, String(raw.numero)).catch(() => false)
    console.error('[V1][GLS][INSERT]', numero, insErr.message, annullata ? 'annullata su GLS' : 'NON annullata su GLS')
    if (annullata) return errore('Spedizione non registrata e annullata sul corriere: riprova.', 500)
  }
  // DVA: l'ordine e' pagato ma la riga non c'e'. Si chiede subito lo storno, come nel portale
  // (lib/storno-dva → stornaOrdineOrfanoDva). Doppio invio scartato dall'indice: risposta della guardia.
  if (insErr && corriere.tipo === 'easyparcel' && raw?._idOrdine) {
    const motivoInsert = insErr.code || insErr.message || 'errore senza messaggio'
    const { stornaOrdineOrfanoDva } = await import('@/lib/storno-dva')
    const storno = await stornaOrdineOrfanoDva(cred?.apikey, raw._idOrdine, { ldv: numero, porta: 'api', motivo: motivoInsert })
    if (insErr.code === '23505') {
      const dup = await spedizioneDoppioneAttiva(admin, { clienteId: ctx.clienteId, rifOrdine: body.rifOrdine, destCap: body.shipTo?.postalCode }).catch(() => null)
      if (dup) {
        await stornaPrenotazione()
        // Al ponte di un altro master si da' il numero del pacco, mai quello interno della gamba (come la guardia).
        const numeroDup = (cliente as any)?.ledger ? (dup.tracking || dup.numero) : dup.numero
        return NextResponse.json({ error: messaggioDoppione(numeroDup), gia_spedito: dup.numero, gia_spedito_id: dup.id }, { status: 409 })
      }
    }
    if (storno !== 'non_riuscito') return errore('Spedizione non registrata per un problema tecnico momentaneo: ne è stato chiesto l\'annullamento al corriere e non viene addebitata. Riprova.', 500)
  }
  if (insErr) { console.error('[V1][INSERT]', numero, insErr.message); return NextResponse.json({ error: `Spedizione creata sul corriere (${numero}) ma non registrata: contatta l'assistenza indicando il numero ${numero}`, tracking: numero }, { status: 500 }) }

  // GLS: etichette non pronte alla creazione, anche di un collo solo → si riprendono in background, come
  // nel portale (lib/gls, recuperaEtichettaGlsSalvando: aggiunge solo quelle dei colli che mancano).
  // Prima questa porta non riprovava mai: il 10/11/2026 28 GLS del ponte di Wave sono nate senza
  // etichetta e sono rimaste cosi' fino alla stampa.
  if (corriere.tipo === 'gls' && inserted?.id && raw?._gls && (!etichettaUrl || glsColliSenzaEtichetta > 0)) {
    const spedBg = { id: inserted.id, corriere_id: corriere.id, colli: packages.length, colli_dettaglio: colliDettaglio, etichetta_url: etichettaUrl, raw_response: raw }
    after(async () => {
      try {
        const { recuperaEtichettaGlsSalvando } = await import('@/lib/gls')
        await recuperaEtichettaGlsSalvando(admin, spedBg, { riprove: [5000, 20000] })
      } catch (e) { console.error('[V1][GLS] recupero etichette background:', (e as any)?.message) }
    })
  }

  // EMAIL BRAND MoovExpress a mittente e destinatario (in background, best-effort):
  // al provider e' andata solo l'email schermo; ai clienti finali scriviamo noi.
  after(async () => {
    try {
      const { inviaEmailSpedizioneCreata } = await import('@/lib/email')
      let notificaDest = true
      if (ctx.clienteId) {
        const { data: cli } = await admin.from('clienti').select('impostazioni').eq('id', ctx.clienteId).maybeSingle()
        notificaDest = (cli?.impostazioni as any)?.notifica_email_dest !== false
      }
      await inviaEmailSpedizioneCreata({
        mittEmail: body.shipFrom?.email, destEmail: body.shipTo?.email,
        mittNome: body.shipFrom?.name, destNome: body.shipTo?.name, destCitta: body.shipTo?.city,
        numero, corriere: corriere.nome_contratto, notificaDest,
        spedizioneId: inserted?.id || null,
      })
    } catch { /* best-effort */ }
  })

  // Addebito credito cliente + cascata master.
  // Se il credito era stato PRENOTATO si CONFERMA quella riga (importo definitivo + numero vero):
  // e' la stessa somma, non un secondo addebito. Solo se la prenotazione non c'era — cliente a
  // fattura, oppure prenotazione fallita — si registra il movimento adesso.
  try {
    if (prenotazioneRif) {
      const rif = prenotazioneRif; prenotazioneRif = null
      const { error: errConf } = await admin.rpc('conferma_prenotazione_spedizione', {
        p_riferimento: rif,
        p_spedizione_id: inserted?.id || null,
        p_descrizione: descrizioneSpedizione(numero, body.shipTo?.name),
        p_importo_finale: Math.abs(costoCliente),
        p_riferimento_finale: numero,
      })
      // Conferma fallita: la prenotazione resta appesa e la libera il giro automatico; si addebita
      // qui, per non lasciare la spedizione senza movimento.
      if (errConf) { console.error('[V1][CONFERMA PRENOTAZIONE]', rif, errConf.message); throw new Error(errConf.message) }
    } else if (costoCliente > 0) {
      await registraMovimento(admin, { masterId, clienteId: ctx.clienteId, tipo: 'spedizione', descrizione: descrizioneSpedizione(numero, body.shipTo?.name), riferimento: numero, importo: -Math.abs(costoCliente), spedizioneId: inserted?.id || null, createdBy: null })
    }
  } catch (e) { console.error('API mov cliente:', e) }
  // IL COMUNE VA PASSATO ANCHE QUI, non solo nel prezzo al cliente.
  //
  // Mancava, ed era l'unica delle sette chiamate alla cascata in tutto il progetto a non averlo —
  // perfino la verifica del credito, venti righe piu' su in QUESTO stesso file, lo passa. Cosi'
  // dentro la stessa richiesta il cliente veniva prezzato col comune e i master addebitati senza.
  //
  // Non e' un dettaglio, perche' senza comune `filtraCapCondiviso` esce subito senza scartare
  // niente: la riga "quel CAP, ma solo per QUEL comune" sopravvive e vince, visto che il CAP esatto
  // ha la precedenza sulla provincia. Su 87020 la riga e' "Verbicaro": una spedizione per Santa
  // Maria del Cedro — stesso CAP, comune diverso — veniva venduta al cliente a tariffa SCS (5,50)
  // e addebitata al suo master a tariffa Zone Disagiate (12,32). Il master ci rimetteva 6,82 a
  // pacco, e il conto lo pagava sempre lui perche' il cliente aveva gia' pagato il prezzo giusto.
  // Misurato: 28 spedizioni in perdita su 31, 156,97 euro in trenta giorni, tutte da questa porta.
  // Dal portale, nella identica situazione, 536 spedizioni e 2 sole in perdita per 0,62 euro.
  try {
    if (corriere.tipo === 'moovexpress') {
      // CONDIVISIONE: SOLO i livelli-ALBERO (il resto l'ha addebitato il dispatch del venditore, a ogni
      // salto). NON addebitaCatena, che risalirebbe l'albero fino all'owner = doppio su credito_proprio.
      await addebitaTreeCondivisione(admin, parametriAlberoV1({ masterId, corriere, body, packages, numero, spedizioneId: inserted?.id || null }))
    } else {
      await addebitaCatena(admin, parametriCatenaV1({ masterId, corriere, body, packages, costoCorrente, numero, spedizioneId: inserted?.id || null }))
    }
  } catch (e) { console.error('API cascata:', e) }

  // IL RITIRO SU POSTE DIRETTO (SDA EXPRESS L, anche attraverso i ponti di condivisione).
  // Alla creazione il contratto Poste non lo prenota: il portale lo fa subito dopo con /api/ritiri/crea,
  // e qui si fa lo stesso, con le stesse funzioni (lib/ritiro-poste). Solo sulla gamba di chi spedisce
  // davvero: sulle gambe sotto il cliente e' il conto di un master collegato (ledger), e prenotare anche
  // li' farebbe un ritiro per ogni livello della fila sullo stesso pacco. Se non riesce la spedizione
  // resta valida (e' gia' creata e pagata): la risposta dice perche' e che si puo' riprovare.
  let avvisoRitiro: string | null = null
  // Il giorno davvero prenotato: KSync rifiuta il ritiro in giornata e lib/ritiro-poste ripiega sul giorno dopo.
  let dataRitiroPrenotata = _dataRitiro
  if (_vuoleRitiro && !ritiroPrenotato && inserted?.id && !(cliente as any)?.ledger
    && (corriere.tipo === 'poste' || corriere.tipo === 'moovexpress')) {
    try {
      const { contrattoCheRitira, prenotaRitiroPoste, motivoRitiroNonValido } = await import('@/lib/ritiro-poste')
      const ritira = await contrattoCheRitira(admin, corriere, numero)
      if (!('corriere' in ritira) || ritira.corriere?.tipo !== 'poste') {
        // Ponte su un contratto che non e' Poste diretto: qui non c'e' un ramo, e /pickups lo rifiuta.
        avvisoRitiro = messaggioRitiroNonPrenotabileViaApi(corriere.tipo)
      } else {
        const motivo = motivoRitiroNonValido(_dataRitiro, body.shipFrom?.phone)
        if (motivo) {
          avvisoRitiro = `Ritiro non prenotato: ${motivo} Correggi e richiedilo con POST /api/v1/pickups.`
        } else {
          const esito = await prenotaRitiroPoste(admin, {
            corriere: ritira.corriere, masterId, clienteId: ctx.clienteId,
            spedizioni: [{ id: inserted.id, numero, tracking_number: numero, colli: packages.length, peso_reale: pesoReale }],
            mittente: {
              nome: body.shipFrom.name, indirizzo: body.shipFrom.street1, citta: body.shipFrom.city, cap: body.shipFrom.postalCode,
              provincia: body.shipFrom.state, paese: 'IT', telefono: body.shipFrom.phone, email: body.shipFrom.email,
            },
            data: _dataRitiro, fascia: _pomeriggio ? 'PM' : 'AM',
            note: body.notes ? String(body.notes) : null, contenuto: body.contenuto ? String(body.contenuto) : null,
          })
          if (esito.ok) {
            ritiroPrenotato = true
            codiceRitiro = esito.codice
            dataRitiroPrenotata = esito.data
            if (esito.data !== _dataRitiro) avvisoRitiro = `Il corriere non accetta il ritiro per il ${_dataRitiro}: ritiro prenotato per il ${esito.data}, il primo giorno utile.`
            // La riga era nata con il ritiro spento (non era ancora prenotato): il portale mostra
            // "Ritiro richiesto" da questi campi.
            await admin.from('spedizioni').update({
              richiedi_ritiro: true, data_ritiro: esito.data, intervallo_ritiro: _pomeriggio ? '14:00-18:00' : '09:00-13:00',
            }).eq('id', inserted.id)
          } else if (esito.motivo === 'registrazione') {
            // Prenotato presso il corriere ma non registrato: il codice va dato, o si rischia un doppione.
            console.error('[V1][RITIRO][POSTE] ritiro prenotato ma non registrato:', esito.codice, esito.errore)
            avvisoRitiro = `Ritiro prenotato presso il corriere (${esito.codice}) ma non registrato a sistema: non richiederlo di nuovo, contatta l'assistenza indicando questo codice.`
          } else {
            avvisoRitiro = `Ritiro non prenotato: ${esito.errore} Puoi riprovare con POST /api/v1/pickups.`
          }
        }
      }
    } catch (e: any) {
      console.error('[V1][RITIRO][POSTE]', e?.message)
      avvisoRitiro = 'Ritiro non prenotato per un errore temporaneo: richiedilo con POST /api/v1/pickups.'
    }
  }

  // Notifica ai webhook del cliente (best-effort: non blocca né fa fallire la creazione)
  inviaWebhook({
    clienteId: ctx.clienteId, corriereId: corriere.id, evento: 'shipment.created',
    data: {
      tracking_number: numero, carrier: corriere.nome_contratto, status: 'in_lavorazione',
      location: body.shipTo?.city || '', events: [],
    },
  }).catch(() => {})

  return NextResponse.json({
    id: inserted?.id || null, tracking: numero, contratto: corriere.nome_contratto,
    prezzo: costoCliente, valuta: 'EUR', label_url: `/api/v1/shipments/${inserted?.id}/label`, stato: 'in_lavorazione',
    // Come si incassera' il contrassegno, quando il contratto e' Poste: lo legge anche il ponte che ha chiamato.
    ...(codModeUsata ? { codMode: codModeUsata } : {}),
    // Se il ritiro e' stato chiesto, la risposta dice se e' stato PRENOTATO e, se no, cosa fare.
    ...(_vuoleRitiro ? { ritiro: ritiroInRisposta({
      prenotato: ritiroPrenotato, data: dataRitiroPrenotata, intervallo: _pomeriggio ? '14:00-18:00' : '09:00-13:00',
      codice: codiceRitiro, tipo: corriere.tipo, spedizioneId: inserted?.id || null, avviso: avvisoRitiro || _avvisoRitiroDeposito,
    }) } : {}),
    // Dove va il pacco, quando non va a casa: il punto come l'ha registrato il corriere.
    ...(puntoConsegna ? { punto_consegna: {
      code: puntoConsegna.code, type: puntoConsegna.type, name: puntoConsegna.name, address: puntoConsegna.address,
      postalCode: puntoConsegna.postalCode, city: puntoConsegna.city, province: puntoConsegna.province,
    } } : puntoInpostScelto ? { punto_consegna: { code: puntoInpostScelto } } : {}),
    ...(depositoTipo ? { deposito: depositoInRisposta(depositoTipo) } : {}),
  })
}
