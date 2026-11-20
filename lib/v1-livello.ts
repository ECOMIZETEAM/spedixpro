import { NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { segna, annota } from '@/lib/cronometro'
import type { ApiContext } from '@/lib/api-auth'
import { calcolaPrezzoListino, calcolaSupplementiCliente, motivoPartenzaNonCoperta } from '@/lib/pricing'
import { verificaCreditoCatena } from '@/lib/cascata'
import { verificaCreditoCondivisione } from '@/lib/condivisione-catena'
import { MSG_TENTATIVO_IN_ANNULLO } from '@/lib/errore-corriere'
import { erroreIndirizzoItaliano, cittaPerLaSpedizione } from '@/lib/citta-spedizione'
import { spedizioneDoppioneAttiva, messaggioDoppione, doppioneSenzaTesta, prenotaOrdineInCreazione, MSG_ORDINE_IN_CORSO } from '@/lib/guardia-doppione'
import { emailValidaSp } from '@/lib/spediamopro'
import { modalitaConsegna, trovaPuntoDaCodice, puntoDichiarato, depositoDaRichiesta, ErrorePunti, type PuntoApi } from '@/lib/punti-consegna'

// UN LIVELLO DELL'API PUBBLICA, PRIMA DI TOCCARE IL CREDITO.
// Sono i controlli e il prezzo di /api/v1/shipments, spostati qui riga per riga e senza cambiarli (20/11/2026):
// richiesta valida, citta' e CAP, cliente e listino, doppione, contratto, colli, punto di consegna, prezzo,
// supplementi e credito della catena. La rotta li chiama come prima, nello stesso ordine.
//
// Perche' fuori dalla rotta: un contratto condiviso oggi passa da questa rotta una volta per ogni master della
// fila (PONTE-UNICO.md), e ogni passaggio rifa' qui i suoi controlli in fila agli altri. Per fare il lavoro di
// tutta la fila in un posto solo bisogna poter chiedere "cosa deciderebbe questo livello" senza la chiamata HTTP:
// la regola resta UNA, questa, e la usano tutte e due le strade.
//
// Restituisce la risposta d'errore, identica a prima, oppure tutto quello che il resto della creazione usa.
// `soloValuta`: nessuna scrittura. Salta la guardia doppioni, che legge le spedizioni gia' nate (e chi valuta in
// ombra lo fa mentre la spedizione vera nasce) e prenota l'ordine in creazione. Il resto e' sola lettura.
export async function valutaLivelloV1(
  admin: ReturnType<typeof createAdminSupabase>,
  ctx: Pick<ApiContext, 'clienteId' | 'corriereId'>,
  body: any,
  opz: { soloValuta?: boolean } = {},
) {
  if (!body.shipTo?.state?.toString().trim() && (body.shipTo?.country || 'IT') === 'IT')
    return NextResponse.json({ error: 'Provincia destinatario obbligatoria (shipTo.state)' }, { status: 400 })
  if (!body.shipTo?.postalCode) return NextResponse.json({ error: 'CAP destinatario obbligatorio (shipTo.postalCode)' }, { status: 400 })
  if (!body.shipFrom?.name || !body.shipFrom?.postalCode) return NextResponse.json({ error: 'Mittente incompleto (shipFrom)' }, { status: 400 })

  // Indirizzo italiano col paese di un altro: stessa regola del portale (lib/valida-citta.ts).
  {
    const fuoriPaese = erroreIndirizzoItaliano({ cap: body.shipTo?.postalCode, citta: body.shipTo?.city, paese: body.shipTo?.country })
    if (fuoriPaese) return NextResponse.json({ error: `${fuoriPaese} (shipTo.country)` }, { status: 400 })
  }

  // Città ↔ CAP su zona speciale: un nome errato farebbe cadere la disagiata/isola su "Italia"
  // (venduto pianura, pagato disagiata). La decisione è quella del portale (lib/citta-spedizione.ts),
  // sulle zone del contratto della chiave: qui si scrive solo il messaggio, che nomina il campo
  // shipTo.city perché chi integra sappia cosa correggere. Dall'API non si corregge mai da soli.
  // Il paese è già controllato sopra, col messaggio che nomina shipTo.country.
  {
    const cd = await cittaPerLaSpedizione({
      admin, corriereId: ctx.corriereId,
      cap: body.shipTo?.postalCode, citta: body.shipTo?.city, paese: body.shipTo?.country,
      daImport: false,
    })
    if (!cd.ok) {
      const suggeriti = cd.suggeriti.slice(0, 6).join(', ')
      return NextResponse.json({ error: `Città "${String(body.shipTo?.city).trim()}" non valida per il CAP ${String(body.shipTo?.postalCode).trim()} (shipTo.city): correggila${suggeriti ? ` (per questo CAP: ${suggeriti})` : ''}. Zona a tariffa speciale: un nome errato la prezzerebbe come destinazione normale.` }, { status: 400 })
    }
  }

  // "Presso" (c/o): seconda riga dell'indirizzo. Accetto `presso` e, come alias, `street2`
  // (così chi arriva da altre piattaforme non deve cambiare payload). Su Spedisci finisce in
  // street2; su SpediamoPro non esiste un campo dedicato -> viene accodato all'indirizzo.
  const pressoFrom = String(body.shipFrom?.presso || body.shipFrom?.street2 || '').trim()
  const pressoTo = String(body.shipTo?.presso || body.shipTo?.street2 || '').trim()
  const conPresso = (via: string, presso: string) => (presso ? `${via} c/o ${presso}`.trim() : via)

  const { data: cliente } = await admin.from('clienti')
    .select('master_id,ragione_sociale,listino_cliente_id,tipo_contratto,credito,ledger').eq('id', ctx.clienteId).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ error: 'Cliente senza listino' }, { status: 400 })
  const masterId = cliente.master_id

  // ANTI-DOPPIONE. Stessa guardia del portale, qui PRIMA della prenotazione del credito: un ordine
  // gia' spedito non deve addebitare nulla. Il backstop vero e' l'indice DB (uniq_sped_ordine_attivo_v2),
  // questo da' solo il 409 pulito a chi integra invece di un errore di vincolo grezzo.
  if (!opz.soloValuta) {
    const dup = await spedizioneDoppioneAttiva(admin, {
      clienteId: ctx.clienteId, rifOrdine: body.rifOrdine, destCap: body.shipTo?.postalCode,
    })
    if (dup) {
      // Chi chiama con la chiave di un conto d'ingrosso e' il ponte di un altro master, e il messaggio arriva
      // fino al suo cliente. Il numero della gamba ("…-216b3342") e' interno. Se il pacco non ha la
      // spedizione del cliente sopra non e' un ordine gia' spedito: e' un tentativo rimasto a meta', che la
      // sentinella (lib/ponte-orfane) sta per annullare. Il 9/11/2026 282343J064551 bloccava cosi' il cliente.
      let messaggio = messaggioDoppione(dup.numero)
      if ((cliente as any)?.ledger) {
        messaggio = await doppioneSenzaTesta(admin, dup.tracking) ? MSG_TENTATIVO_IN_ANNULLO : messaggioDoppione(dup.tracking || dup.numero)
      }
      return NextResponse.json({ error: messaggio, gia_spedito: dup.numero, gia_spedito_id: dup.id }, { status: 409 })
    }
    // Stesso ordine gia' in creazione da un'altra chiamata di pochi secondi fa: ci si ferma PRIMA di
    // comprare la LDV, come nel portale (lib/guardia-doppione → prenotaOrdineInCreazione).
    const inCreazione = await prenotaOrdineInCreazione(admin, {
      clienteId: ctx.clienteId, rifOrdine: body.rifOrdine, destCap: body.shipTo?.postalCode,
    })
    if (inCreazione === 'occupato') return NextResponse.json({ error: MSG_ORDINE_IN_CORSO, in_corso: true }, { status: 409 })
    if (inCreazione) after(inCreazione.libera)
  }

  // Nessun blocco per limite o canone: chi si integra e' un CLIENTE, e non deve subire i conti
  // fra noi e il suo master. Il blocco vive nel portale di chi non e' in regola.

  const { data: corriere } = await admin.from('corrieri')
    .select('id,tipo,credenziali,nome_contratto,attivo,master_id,settings,multicollo').eq('id', ctx.corriereId).single()
  if (!corriere) return NextResponse.json({ error: 'Contratto non trovato' }, { status: 400 })
  if (corriere.attivo === false) return NextResponse.json({ error: 'Contratto in pausa' }, { status: 400 })
  // La pausa messa da un master SOPRA vale anche per le chiamate via API: altrimenti bastava
  // integrarsi per continuare a spedire con un contratto sospeso a monte.
  {
    const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
    const sospesi = await contrattiSospesiSopra((corriere as any).master_id)
    if (sospesoDallaCatena(corriere.nome_contratto, sospesi)) {
      return NextResponse.json({ error: 'Contratto momentaneamente sospeso' }, { status: 400 })
    }
  }
  const cred = corriere.credenziali as Record<string, string>

  // `weight` in cima al corpo vale anche qui. Il preventivo (v1/rates) lo accetta da sempre, la
  // creazione lo ignorava e spediva 1 kg: chi avesse quotato 30 kg e poi creato con lo stesso
  // corpo si sarebbe visto addebitare un chilo, e la differenza la mettevamo noi. Oggi non lo usa
  // nessuno (zero spedizioni in 90 giorni sul collo predefinito), ma le due porte devono
  // rispondere allo stesso corpo nello stesso modo.
  const packages = Array.isArray(body.packages) && body.packages.length
    ? body.packages
    : [{ weight: Number(body.weight) || 1, length: 20, width: 15, height: 10 }]
  if (packages.length > 1 && (corriere as any).multicollo === false)
    return NextResponse.json({ error: 'Il contratto non prevede il multicollo' }, { status: 400 })
  const pkg = packages[0]
  const pesoReale = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1

  // I LIMITI DEL COLLO VALGONO ANCHE QUI.
  // Misure massime, peso per collo, numero di colli, somma dei lati, limite combinato e scaglioni
  // di misura erano applicati solo dal portale: chi spediva dalle API o dai negozi online li
  // scavalcava tutti. E' la porta da cui passano i volumi automatici, quindi proprio quella dove
  // un collo fuori sagoma entra a ripetizione — e poi il corriere lo fattura con i suoi
  // supplementi, che a noi nessuno rimborsa.
  // Stessa libreria del portale: una regola sola, stesso esito da qualunque parte si entri.
  const { motivoLimiteCollo } = await import('@/lib/limiti-collo')
  const _motivoLimite = motivoLimiteCollo((corriere as any)?.settings, pesoReale, packages)
  if (_motivoLimite) {
    return NextResponse.json({ error: `Collo non accettato da questo contratto: ${_motivoLimite}.` }, { status: 400 })
  }

  // GLS DIRETTO CHE NON PUO' FARE QUESTA SPEDIZIONE: le stesse regole della creazione dal portale, prima
  // del credito. Il nazionale non va all'estero; il Parcel (Europa) non va in Italia, ne' fuori dall'UE,
  // ne' col contrassegno, e vuole il telefono del destinatario.
  if (corriere.tipo === 'gls') {
    const { motivoGlsNonServe, servizioGls } = await import('@/lib/gls')
    const no = motivoGlsNonServe(corriere, { paese: body.shipTo?.country, cap: body.shipTo?.postalCode, contrassegno: body.codValue })
      || (servizioGls((corriere as any).settings) === 'P' && String(body.shipTo?.phone || '').replace(/\D/g, '').length < 6
        ? 'Per GLS Europa serve il telefono del destinatario (shipTo.phone).' : null)
    if (no) return NextResponse.json({ error: no }, { status: 400 })
  }

  // IL RITIRO CHIESTO DA CHI INTEGRA.
  // Si accettano due forme perche' l'API pubblica parla inglese ma i client italiani mandano gia'
  // i nomi del portale: meglio leggere tutte e due che rispondere 200 OK ignorando la richiesta.
  const _vuoleRitiro = (body.pickup?.requested === true || body.richiediRitiro === true)
    && !!(body.pickup?.date || body.dataRitiro)
  const _dataRitiro = String(body.pickup?.date || body.dataRitiro || '')
  const _pomeriggio = String(body.pickup?.time || body.orarioRitiro || '').toLowerCase().startsWith('pom')

  // CONSEGNA A UN PUNTO (PuntoPoste, Ufficio Postale, Fermopoint, locker).
  // Fino al 09/11/2026 questa porta non leggeva nessun punto: sui contratti a punto il fornitore
  // rifiutava l'ordine (o non c'era modo di dire dove consegnare), quindi da qui non si spediva.
  // Le regole sono quelle della creazione dal portale, nello stesso ordine, e TUTTE prima di toccare
  // il credito o il corriere: su questi contratti dopo l'ordine non si torna indietro.
  //   deliveryPoint.code  = il punto, preso da GET /api/v1/delivery-points (anche come stringa);
  //   deliveryPoint.postalCode = il CAP del punto (facoltativo: senza, si cerca vicino a shipTo);
  //   dropoffType = dove il mittente deposita sui contratti PuntoPoste: ufficio_postale | punto_poste.
  // Il PREZZO resta quello di oggi, sull'indirizzo del destinatario (shipTo), come nel portale: il
  // punto si sceglie vicino a lui. Sul ponte di condivisione decide il venditore: qui si passa e basta.
  const _modalita = corriere.tipo === 'moovexpress' ? null : modalitaConsegna(corriere)
  const _dp = body.deliveryPoint
  const _codicePunto = String((_dp && typeof _dp === 'object' ? _dp.code : _dp) || body.shipTo?.pointCode || '').trim()
  const _capPunto = String((_dp && typeof _dp === 'object' ? (_dp.postalCode || _dp.cap) : '') || '').trim()
  let puntoConsegna: PuntoApi | null = null       // il punto ritrovato fra quelli del contratto
  let depositoTipo: 'FMP' | 'APT' | null = null   // pudo_mittente dei contratti PuntoPoste
  if (_modalita) {
    if (!_modalita.aUnPunto && (_dp != null || body.shipTo?.pointCode)) {
      return NextResponse.json({ error: 'Questo contratto consegna a domicilio: deliveryPoint non è previsto. La consegna a un punto si fa con la chiave di un contratto a punto (vedi GET /api/v1/account).' }, { status: 400 })
    }
    if (_modalita.deposito) {
      depositoTipo = depositoDaRichiesta(body.dropoffType ?? body.depositoTipo)
      if (!depositoTipo) {
        return NextResponse.json({ error: 'Su questo contratto il mittente porta il pacco in un Ufficio Postale o in un Punto Poste: indica dropoffType = "ufficio_postale" oppure "punto_poste".' }, { status: 400 })
      }
    }
    // InPost diretto passa il codice al corriere cosi' com'e' (vedi il suo ramo): qui solo gli altri.
    if (_modalita.aUnPunto && !_modalita.inpostLocker) {
      if (!_codicePunto) {
        return NextResponse.json({ error: 'Questo contratto consegna a un punto: indica deliveryPoint.code (cerca i punti con GET /api/v1/delivery-points).' }, { status: 400 })
      }
      // Il codice per ritirare (PIN Fermopoint, apertura locker) il corriere lo manda all'email del
      // destinatario: senza, il pacco arriva al punto e nessuno lo puo' ritirare (portale, 14/10).
      if (_modalita.emailObbligatoria && !emailValidaSp(body.shipTo?.email)) {
        return NextResponse.json({ error: "Email del destinatario obbligatoria (shipTo.email): per la consegna al punto il corriere gli manda lì il codice per ritirare il pacco." }, { status: 400 })
      }
      // Il punto si RITROVA fra quelli del contratto: un codice di un altro corriere fa rifiutare
      // l'ordine (successo dal portale, 21-23/09), e l'indirizzo del punto serve a etichetta e preventivo.
      const capRicerca = _capPunto || String(body.shipTo?.postalCode || '').trim()
      try {
        puntoConsegna = await trovaPuntoDaCodice(corriere, _codicePunto, { cap: capRicerca, citta: _capPunto ? undefined : body.shipTo?.city })
      } catch (e: any) {
        if (!(e instanceof ErrorePunti)) throw e
        // Ricerca del fornitore giu' (non un CAP sbagliato): si usa il punto rimandato da chi integra,
        // se e' completo — come fa il portale col punto scelto nel browser. Altrimenti si dice di riprovare.
        const dichiarato = e.stato >= 500 ? puntoDichiarato(_dp, _codicePunto) : null
        if (!dichiarato) {
          return NextResponse.json({ error: e.stato >= 500
            ? `${e.message} Riprova tra poco, oppure manda in deliveryPoint il punto intero come restituito da GET /api/v1/delivery-points (code, address, postalCode, city, province).`
            : e.message }, { status: e.stato })
        }
        console.error('[V1][PUNTO] ricerca del fornitore giu\': si usa il punto rimandato da chi integra', _codicePunto, dichiarato.postalCode)
        puntoConsegna = dichiarato
      }
      if (!puntoConsegna) {
        return NextResponse.json({ error: `Punto ${_codicePunto} non trovato fra quelli di questo contratto vicino al CAP ${capRicerca}: usa un code restituito da GET /api/v1/delivery-points e passa anche deliveryPoint.postalCode (il CAP del punto).` }, { status: 400 })
      }
    }
  }
  // Sui contratti PuntoPoste il pacco lo porta il mittente: il corriere non passa. Il fornitore
  // rifiuta l'ordine con un ritiro dentro (175 "Ritiro non attivabile"): come il portale, si spegne.
  const _ritiroAlCorriere = _vuoleRitiro && !_modalita?.deposito
  const _avvisoRitiroDeposito = (_vuoleRitiro && _modalita?.deposito)
    ? 'Su questo contratto il pacco lo consegna il mittente in un Ufficio Postale o in un Punto Poste (dropoffType): il ritiro non è previsto.'
    : null

  // Prezzo a carico del cliente (listino cliente, contratto della key)
  const ris = await calcolaPrezzoListino(admin, {
    listinoId: cliente.listino_cliente_id,
    provincia: (body.shipTo.state || '').toUpperCase().trim(),
    cap: (body.shipTo.postalCode || '').toString().trim(),
    paese: (body.shipTo.country || 'IT').toUpperCase().trim(),
    citta: (body.shipTo.city || '').toString().trim(),   // CAP condivisi tra più comuni
    packages, corriereId: ctx.corriereId,
    mittCap: (body.shipFrom.postalCode || '').toString().trim(), mittProvincia: (body.shipFrom.state || '').toUpperCase().trim(), mittPaese: 'IT',
  })
  if (!ris) {
    const partenza = await motivoPartenzaNonCoperta(admin, corriere, { cap: body.shipFrom.postalCode, provincia: body.shipFrom.state })
    return NextResponse.json({ error: partenza || 'Destinazione non coperta dal listino per questo contratto (zona non prezzata): spedizione non creabile con questo corriere.' }, { status: 400 })
  }

  // Supplementi contrassegno/assicurazione dal listino cliente (stessa logica del portale)
  const supp = await calcolaSupplementiCliente(admin, {
    listinoId: cliente.listino_cliente_id, corriereId: ctx.corriereId,
    contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
    valoreMerce: Number(body.valoreMerce || 0), nolo: ris.prezzo, pesoReale,
  })
  if (!supp.disponibile) return NextResponse.json({ error: 'Importo contrassegno/assicurazione oltre il massimo consentito per questo contratto' }, { status: 400 })
  const costoCliente = Math.round((ris.prezzo + supp.contrassegno + supp.assicurazione) * 100) / 100

  // Verifica credito della catena master
  // GLI STESSI ARGOMENTI DEL PORTALE, che chiama questa identica funzione dieci righe diverse piu'
  // in la'. Qui mancavano CONTRASSEGNO e ASSICURAZIONE: il credito veniva verificato sul solo nolo
  // e poi addebitato col supplemento, quindi passava chi non aveva capienza per l'importo vero.
  // Non e' un caso di scuola: 279 spedizioni con contrassegno via API in trenta giorni.
  // Mancava anche CITTA', e senza quella i livelli superiori della catena prezzano il CAP condiviso
  // in modo diverso dal cliente — la stessa spedizione, due zone.
  // CONDIVISIONE: per un ponte (tipo='moovexpress') il gating è sui livelli-ALBERO (CODICE/OWNER li gata
  // il dispatch del venditore). La vecchia verificaCreditoCatena qui bloccherebbe con "MoovExpress non ha
  // listino" (sale l'albero fino alla piattaforma). Gli altri corrieri restano IDENTICI.
  segna('prima della catena'); annota('tipo', String(corriere.tipo || ''))
  const catena = corriere.tipo === 'moovexpress'
    ? await verificaCreditoCondivisione(admin, {
        masterOriginante: masterId, nomeContratto: corriere.nome_contratto,
        dest: { cap: body.shipTo.postalCode, provincia: body.shipTo.state, citta: body.shipTo.city, paese: body.shipTo.country || 'IT' },
        packages, contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
        mittCap: (body.shipFrom.postalCode || '').toString().trim(), mittProvincia: (body.shipFrom.state || '').toUpperCase().trim(), mittPaese: 'IT',
      })
    : await verificaCreditoCatena(admin, {
    masterDirettoId: masterId, corriereOwnerId: corriere.master_id,
    provincia: body.shipTo.state, packages, cap: body.shipTo.postalCode, paese: body.shipTo.country || 'IT',
    citta: body.shipTo.city,
    corriereNome: corriere.nome_contratto,
    contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
    mittCap: (body.shipFrom.postalCode || '').toString().trim(), mittProvincia: (body.shipFrom.state || '').toUpperCase().trim(), mittPaese: 'IT',
    // Con che zona e a che prezzo e' stato calcolato il cliente: serve al controllo "due zone sulla
    // stessa spedizione" dentro verificaCreditoCatena, che vale per tutte le porte insieme.
    zonaCliente: ris.zona, prezzoCliente: costoCliente,
  })
  // NON E' SEMPRE CREDITO. La stessa verifica fallisce anche quando la catena non e' configurata o
  // quando cliente e contratto risolvono due zone diverse: rispondere sempre "Credito insufficiente"
  // mandava chi integra a ricaricare un conto che era gia' pieno, mentre il problema era un altro.
  segna('catena')
  if (!catena.ok) {
    const eCredito = /credito insufficiente/i.test(catena.errore || '')
    return NextResponse.json({ error: catena.errore || 'Credito insufficiente' }, { status: eCredito ? 402 : 400 })
  }

  return {
    cliente, masterId, corriere, cred, packages, pkg, pesoReale, pressoFrom, pressoTo, conPresso,
    _vuoleRitiro, _dataRitiro, _pomeriggio, _modalita, _codicePunto, puntoConsegna, depositoTipo,
    _ritiroAlCorriere, _avvisoRitiroDeposito, ris, supp, costoCliente, catena,
  }
}
