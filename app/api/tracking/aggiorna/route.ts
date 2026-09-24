import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, spediamoproSearchStocks, mapStatoSpediamopro, spediamoproEventiIndicanoReso, spediamoproGetLabel, normalizzaEtichetta } from '@/lib/spediamopro'
import { rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'
import { spedisciTrackingStati, mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'
import { notificaCambioStato } from '@/lib/tracking-notifica'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (ogni 4h): aggiorna lo stato delle spedizioni ancora "attive" leggendo il tracking
// dai corrieri. SpediamoPro: mappa lo status 0-13; lo status 11 (eccezione) → controlla gli
// stock: se c'è uno stock attivo → in_giacenza, altrimenti non_consegnato.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  // Il tempo si conta da QUI, dall'avvio della funzione: prima partiva dopo il caricamento delle
  // spedizioni attive, che non veniva contato, e il giro poteva arrivare ai 300 secondi senza accorgersene.
  const avvioMs = Date.now()
  const admin = createAdminSupabase()

  // Escludo anche gli stati di annullamento: il tracking NON deve sovrascrivere una spedizione
  // in attesa di annullo (altrimenti perde 'annullamento_pending' e il cron annulli non la trova).
  // Copro TUTTE le spedizioni attive per giro (ordinate dalle meno aggiornate): con limit basso
  // (era 300) e molte spedizioni attive, quelle "in coda" — comprese le nuove GIACENZE — non
  // venivano mai raggiunte e non comparivano nella sezione Giacenze. Un giro da 300 impiega ~12s,
  // quindi c'è ampio margine sotto maxDuration. NB: a volumi molto alti va spezzato in batch
  // con un campo "ultimo_check_tracking" (round-robin) — vedi TODO cron tracking scalabile.
  // A PAGINE: PostgREST tronca ogni risposta a 1000 righe (il vecchio .limit(3000) era
  // silenziosamente tagliato -> ogni giro copriva solo le prime 1000 attive). Carico tutte
  // le pagine PRIMA di processare, con dedup per id (le pagine possono slittare se qualche
  // riga cambia stato nel frattempo).
  // IL TETTO DEVE GRIDARE, NON TRONCARE IN SILENZIO.
  // Le pagine erano 8, cioe' 8.000 spedizioni per giro, e le attive sono arrivate a 7.971: a
  // ventinove dal limite. Superarlo non da' errore — le eccedenti semplicemente non vengono
  // guardate. La rotazione per tracking_check_at fa si' che al giro dopo tocchi a loro, quindi non
  // si perdono; ma piu' si sfora, piu' cresce il ritardo, e nessuno se ne accorgerebbe.
  // Le pagine salgono a 12 (non di piu': con 8.000 righe questa funzione e' gia' stata uccisa per
  // memoria esaurita, ed e' il motivo per cui qui si leggono poche colonne e mai i PDF).
  // E se anche 12 non bastassero, adesso resta scritto nei log.
  const PAGINE_MAX = 12
  const vistiIds = new Set<string>()
  const spedizioni: any[] = []
  let tettoRaggiunto = false
  for (let pag = 0; pag < PAGINE_MAX; pag++) {
    const { data: pagina } = await admin.from('spedizioni')
      // MAI 'raw_response' né 'etichetta_url' interi: l'etichetta è il PDF in base64 (156 KB in
      // media) e la risposta del corriere ~43 KB. Su 8.000 righe superavano il gigabyte e la
      // funzione veniva UCCISA per memoria esaurita (4 volte nelle ultime 24h): il giro moriva
      // a metà e il tracking restava indietro per tutti. Qui servono solo tre valori, presi
      // direttamente dal JSON, e l'etichetta si guarda a parte (solo gli id di chi non ce l'ha).
      // ep_offerta/ep_ordine: i due riferimenti del terzo provider. Il tracking si interroga col
      // CODICE OFFERTA (per LDV risponde "Spedizione non trovata"), l'etichetta con l'id ordine.
      .select('id,numero,stato,tracking_number,giacenza_data,giacenza_motivo,giacenza_apertura_addebitata,giacenza_addebito_effettuato,cliente_id,master_id,corriere_id,corrieri(tipo,credenziali,nome_contratto),sp_id:raw_response->id,sp_id_annidato:raw_response->raw->data->id,sp_code:raw_response->code,ep_offerta:raw_response->_codiceOfferta,ep_ordine:raw_response->_idOrdine,gls_numero:raw_response->numero,brt_parcel:raw_response->parcelID,fedex_test:raw_response->test,richiedi_ritiro,ritiro_id,created_at,ep_ritiro:raw_response->_codiceRitiro')
      .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
      .order('tracking_check_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(pag * 1000, pag * 1000 + 999)
    for (const r of pagina || []) { if (!vistiIds.has(r.id)) { vistiIds.add(r.id); spedizioni.push(r) } }
    if (!pagina || pagina.length < 1000) break
    if (pag === PAGINE_MAX - 1) tettoRaggiunto = true
  }
  if (tettoRaggiunto) {
    console.error('[TRACKING][TETTO] lette', spedizioni.length, 'spedizioni: e\' il massimo per giro.',
      'Le altre slittano al giro dopo. Se si ripete, il giro va spezzato in piu\' esecuzioni.')
  }

  // Chi non ha l'etichetta: SOLO gli id, così sappiamo per quali tentare il recupero senza
  // portarci in memoria i PDF di tutte le altre.
  const senzaEtichetta = new Set<string>()
  for (let pag = 0; pag < PAGINE_MAX; pag++) {
    const { data: pagina } = await admin.from('spedizioni')
      .select('id').is('etichetta_url', null)
      .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
      .order('id', { ascending: true })
      .range(pag * 1000, pag * 1000 + 999)
    for (const r of pagina || []) senzaEtichetta.add((r as any).id)
    if (!pagina || pagina.length < 1000) break
  }

  let aggiornate = 0, errori = 0
  let spedisciBloccato = false   // breaker: al primo 403 di policy niente altre chiamate Spedisci nel giro
  // BUDGET DI RECUPERO DELLE CRONOLOGIE (solo terzo provider, vedi il ramo 'easyparcel').
  // Le spedizioni gia' esistenti non hanno mai avuto eventi salvati: sono migliaia, e riscriverle
  // tutte in un giro solo ucciderebbe questa funzione, che va gia' in timeout. Se ne recupera un
  // pezzo per volta; le spedizioni che si MUOVONO passano sempre, fuori budget.
  let budgetCronologie = 300
  let chiaviEventoIgnote: string[] = []
  const lavora = async (s: any) => {
    const corr: any = (s as any).corrieri
    const tipo = corr?.tipo
    const cred: any = corr?.credenziali || {}

    try {
      let nuovo: string | null = null
      let nuovoTracking: string | null = null
      let motivoGiacenza: string | null = null   // causale del corriere (rifiuto, assente, indirizzo errato…)
      // LA GIACENZA E' UN FATTO, NON IL MASSIMO DI UNA CLASSIFICA. `nuovo` qui sotto e' lo stato PIU'
      // AVANZATO fra quelli letti dal corriere, e nella scala in_giacenza vale 4 mentre
      // non_consegnato vale 5: siccome la mancata consegna accompagna SEMPRE la giacenza, `nuovo`
      // diventa 'non_consegnato' e la giacenza non veniva registrata mai (misurato il 18/09: 256
      // spedizioni con l'evento di giacenza scritto e `giacenza_data` nulla, 101 delle quali su
      // corrieri che passano SOLO di qui, senza webhook). Questo flag dice "la giacenza l'abbiamo
      // vista", a prescindere da chi vince la classifica degli stati.
      let vistaGiacenza = false
      // Contesto SpediamoPro per il recupero di numero/etichetta rimasti indietro (vedi sotto).
      let spAuth: string | null = null
      let spId: number | null = null
      let spCode: string | null = null

      if (tipo === 'spediamopro') {
        // Valori presi dalle sole chiavi che servono (vedi select sopra), non dall'intero JSON.
        const spid = (s as any).sp_id ?? (s as any).sp_id_annidato
        const authcode = cred?.authcode
        if (!spid || !authcode) return
        spAuth = authcode; spId = Number(spid); spCode = (s as any).sp_code || null

        const tr = await spediamoproGetTracking(authcode, Number(spid))
        nuovo = mapStatoSpediamopro(tr.status)
        if (nuovo === 'eccezione') {
          // distinguo giacenza (stock attivo) da altre eccezioni
          try {
            const stocks = await spediamoproSearchStocks(authcode, tr.shipmentCode || (s as any).sp_code || String(spid))
            const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && Number(st.shipmentId) === Number(spid))
            nuovo = attivo ? 'in_giacenza' : 'non_consegnato'
            // Solo lo stock ATTIVO, di proposito: qui la data sarebbe "adesso", e una giacenza gia'
            // chiusa verrebbe aperta con una data falsa (e addebitata). Il recupero delle giacenze
            // passate e' un'altra cosa, e si fa col webhook che porta `opened_at`.
            if (attivo) vistaGiacenza = true
            // MOTIVO dichiarato dal corriere (es. "Rifiuto del destinatario"): serve all'operatore
            // per scegliere lo svincolo GIUSTO — su un pacco rifiutato la riconsegna viene respinta
            // dal corriere, l'unica strada e' il reso al mittente.
            if (attivo?.reason) motivoGiacenza = String(attivo.reason).slice(0, 200)
          } catch { nuovo = 'non_consegnato' }
        }
        // RESO AL MITTENTE: lo status numerico non lo distingue (una riconsegna al mittente registra
        // come "consegnata"); lo dicono gli EVENTI. Se il pacco e' stato reso, lo stato e'
        // reso_mittente — e il trigger DB (trg_reso_da_addebitare) mette in coda l'addebito del reso.
        // Vince su tutto il resto (anche su una eventuale eccezione/giacenza dello stesso giro).
        if (spediamoproEventiIndicanoReso(tr.events)) nuovo = 'reso_mittente'
        if (tr.trackingCode) nuovoTracking = tr.trackingCode

        // CRONOLOGIA. Gli eventi erano gia' qui — `tr.events`, usati sopra per riconoscere il reso —
        // e finivano nel nulla: 9.190 spedizioni in cinque giorni con lo stato che avanzava e la
        // pagina di tracking vuota. La forma e' documentata in lib/spediamopro: { at, title,
        // description }. Regole e scrittura in lib/tracking-eventi, uguali per tutti i provider.
        try {
          const cambiatoSp = nuovo !== s.stato
          if (cambiatoSp || budgetCronologie > 0) {
            const { normalizzaEventi, scriviCronologia } = await import('@/lib/tracking-eventi')
            const { eventi, chiaviIgnote } = normalizzaEventi(tr.events, {
              data: ['at', 'date', 'datetime', 'data'],
              descrizione: ['description', 'title'],
              luogo: ['location', 'place', 'luogo'],
            })
            if (chiaviIgnote.length && !chiaviEventoIgnote.length) chiaviEventoIgnote = chiaviIgnote
            if (eventi.length) {
              if (!cambiatoSp) budgetCronologie--
              await scriviCronologia(admin, s.id, eventi)
            }
          }
        } catch (e: any) { console.error('[TRACKING][SP][EVENTI]', s.numero, e?.message) }

      } else if (tipo === 'spedisci') {
        // Il provider ha CHIUSO il polling (403 "use the Webhooks events"): il WEBHOOK resta la
        // fonte primaria. Qui TENTIAMO comunque a ogni giro: se il blocco viene rimosso, il polling
        // riparte DA SOLO (ogni 30 min); al primo 403 di policy fermiamo il resto del giro
        // (zero chiamate sprecate). Lo stato avanza SOLO in avanti come per SpediamoPro.
        if (spedisciBloccato) return
        if (!s.tracking_number || !cred?.master_domain || !cred?.password) return
        const { stati, raw, ok } = await spedisciTrackingStati(cred, s.tracking_number)
        if (!ok) { if (JSON.stringify(raw || {}).includes('Webhooks events')) spedisciBloccato = true; return }
        for (const str of stati) {
          const m = mapStatoSpedisci(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        if (stati.some((str) => mapStatoSpedisci(str) === 'in_giacenza')) vistaGiacenza = true
        // Il reso vince sulla consegna del ritorno (vedi sotto, dove si applica lo stato).
        if (stati.some((str) => mapStatoSpedisci(str) === 'reso_mittente')) nuovo = 'reso_mittente'

      } else if (tipo === 'easyparcel') {
        // Si interroga col CODICE OFFERTA, non con la LDV (verificato sul campo: la ricerca per
        // LDV risponde "Spedizione non trovata"). Senza quel riferimento non c'e' nulla da chiedere.
        const offerta = (s as any).ep_offerta
        if (!offerta || !cred?.apikey) return
        const { easyparcelTracking, mapStatoEasyparcel } = await import('@/lib/easyparcel')
        const { stati, raw } = await easyparcelTracking(cred.apikey, { codiceOfferta: String(offerta) })
        for (const str of stati) {
          const m = mapStatoEasyparcel(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        if (stati.some((str) => mapStatoEasyparcel(str) === 'in_giacenza')) vistaGiacenza = true
        // Il reso vince sulla consegna del ritorno (vedi sotto, dove si applica lo stato).
        if (stati.some((str) => mapStatoEasyparcel(str) === 'reso_mittente')) nuovo = 'reso_mittente'
        // La LDV compare nel tracking anche quando alla creazione non era ancora pronta: e' la
        // seconda occasione per rimpiazzare il numero provvisorio "DVA-<ordine>".
        const ldv = (raw as any)?.tracking?.lettera_vettura
        if (ldv) nuovoTracking = String(ldv)

        // CRONOLOGIA DEGLI EVENTI — l'unico provider che non la salvava.
        //
        // Di questa stessa risposta si teneva solo il testo per calcolare lo stato, e `raw` — che
        // contiene la cronologia completa — veniva buttato via. Cosi' per OGNI spedizione di questo
        // provider (8.013 in dieci giorni, contate) il cliente e il destinatario vedevano lo stato
        // avanzare ma la pagina di tracking con la cronologia vuota. Gli altri due provider gli
        // eventi li scrivono da sempre (webhook Spedisci, poller GLS): qui non era rotto niente,
        // semplicemente non era mai stato fatto.
        //
        // CANCELLA E RISCRIVI, come nel poller Poste: la risposta arriva COMPLETA a ogni giro, e
        // aggiungere in coda riempirebbe il popup di doppioni.
        //
        // Quando: sempre se lo stato e' cambiato — li' c'e' davvero qualcosa di nuovo — e per il
        // resto a piccole dosi (budgetCronologie), per recuperare lo storico vecchio senza far
        // scadere il giro.
        try {
          const cambiato = nuovo !== s.stato
          if (cambiato || budgetCronologie > 0) {
            const { eventiEasyparcel } = await import('@/lib/easyparcel')
            const { scriviCronologia } = await import('@/lib/tracking-eventi')
            const { eventi, chiaviIgnote } = eventiEasyparcel(raw)
            if (chiaviIgnote.length && !chiaviEventoIgnote.length) chiaviEventoIgnote = chiaviIgnote
            if (eventi.length) {
              if (!cambiato) budgetCronologie--
              await scriviCronologia(admin, s.id, eventi)
            }
          }
        } catch (e: any) {
          // La cronologia e' un di piu': se non si scrive, lo STATO deve aggiornarsi lo stesso.
          console.error('[TRACKING][EP][EVENTI]', s.numero, e?.message)
        }

      } else if (tipo === 'gls') {
        // GLS DIRETTO (contratto proprio): il webservice di creazione non dà lo stato di consegna,
        // lo legge il T&T Infoweb (manuale MU40). Serve il numero NUDO salvato in raw_response.numero
        // alla creazione — il tracking_number è prefissato (NL…), che il T&T non accetta. Le
        // credenziali (sigla_sede/codice_contratto) arrivano dalla join corrieri.credenziali via admin.
        const numeroNudo = (s as any).gls_numero
        if (!numeroNudo || !cred?.sigla_sede) return
        const { trackingGls, mapStatoGls } = await import('@/lib/gls')
        const { stati } = await trackingGls(cred, String(numeroNudo))
        for (const str of stati) {
          const m = mapStatoGls(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        if (stati.some((str) => mapStatoGls(str) === 'in_giacenza')) vistaGiacenza = true
        // Il reso vince sulla consegna del ritorno (vedi sotto, dove si applica lo stato).
        if (stati.some((str) => mapStatoGls(str) === 'reso_mittente')) nuovo = 'reso_mittente'

      } else if (tipo === 'brt') {
        // BRT DIRETTO: lo stato di consegna si legge da GET /tracking/parcelID/{parcelID} (barcode 18
        // char) salvato in raw_response alla creazione. Best-effort: se la risposta non torna, nessun
        // aggiornamento (mai declassa).
        const brtParcel = (s as any).brt_parcel
        if (!brtParcel || !cred?.user || !cred?.password) return
        const { trackingBrt, mapStatoBrt } = await import('@/lib/brt')
        const { stati, consegnata: brtConseg, eventi: brtEventi } = await trackingBrt(cred, String(brtParcel))
        for (const str of stati) {
          const m = mapStatoBrt(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        // Consegna dal campo dedicato di BRT (non serve l'evento testuale "CONSEGNATA").
        if (brtConseg && prioritaStato('consegnata') > prioritaStato(nuovo)) nuovo = 'consegnata'
        if (stati.some((str) => mapStatoBrt(str) === 'in_giacenza')) vistaGiacenza = true
        // ...ma se il pacco e' tornato al mittente, quella consegna e' il RITORNO: vince il reso.
        if (stati.some((str) => mapStatoBrt(str) === 'reso_mittente')) nuovo = 'reso_mittente'

        // CRONOLOGIA. trackingBrt torna gia' `eventi` nella forma giusta ({ data, descrizione,
        // luogo }) e nessuno li salvava: stato che avanza, pagina di tracking vuota. Come per gli
        // altri, la data si legge e si scrive con le regole di lib/tracking-eventi.
        try {
          const cambiatoBrt = nuovo !== s.stato
          if (cambiatoBrt || budgetCronologie > 0) {
            const { normalizzaEventi, scriviCronologia } = await import('@/lib/tracking-eventi')
            const { eventi, chiaviIgnote } = normalizzaEventi(brtEventi, {
              data: ['data', 'dataOra', 'datetime'],
              descrizione: ['descrizione'],
              luogo: ['luogo'],
            })
            if (chiaviIgnote.length && !chiaviEventoIgnote.length) chiaviEventoIgnote = chiaviIgnote
            if (eventi.length) {
              if (!cambiatoBrt) budgetCronologie--
              await scriviCronologia(admin, s.id, eventi)
            }
          }
        } catch (e: any) { console.error('[TRACKING][BRT][EVENTI]', s.numero, e?.message) }

      } else if (tipo === 'fedex') {
        // FedEx DIRETTO: lo stato si legge da POST /track/v1/trackingnumbers col tracking_number (che
        // per FedEx È il masterTrackingNumber). Le chiavi Track del contratto (o le Ship) arrivano dalla
        // join credenziali. Best-effort: nessuna risposta = nessun aggiornamento (mai declassa).
        const fedexTn = (s as any).tracking_number
        if (!fedexTn || !(cred?.track_api_key || cred?.api_key)) return
        const { trackingFedex, mapStatoFedex } = await import('@/lib/fedex')
        const { stati, consegnata: fxConseg, eventi: fxEventi } = await trackingFedex(cred, String(fedexTn), (s as any).fedex_test === true)
        for (const str of stati) {
          const m = mapStatoFedex(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        if (fxConseg && prioritaStato('consegnata') > prioritaStato(nuovo)) nuovo = 'consegnata'
        if (stati.some((str) => mapStatoFedex(str) === 'in_giacenza')) vistaGiacenza = true
        // ...ma se il pacco e' tornato al mittente, quella consegna e' il RITORNO: vince il reso.
        if (stati.some((str) => mapStatoFedex(str) === 'reso_mittente')) nuovo = 'reso_mittente'

        try {
          const cambiatoFx = nuovo !== s.stato
          if (cambiatoFx || budgetCronologie > 0) {
            const { normalizzaEventi, scriviCronologia } = await import('@/lib/tracking-eventi')
            const { eventi, chiaviIgnote } = normalizzaEventi(fxEventi, {
              data: ['data', 'dataOra', 'datetime'],
              descrizione: ['descrizione'],
              luogo: ['luogo'],
            })
            if (chiaviIgnote.length && !chiaviEventoIgnote.length) chiaviEventoIgnote = chiaviIgnote
            if (eventi.length) {
              if (!cambiatoFx) budgetCronologie--
              await scriviCronologia(admin, s.id, eventi)
            }
          }
        } catch (e: any) { console.error('[TRACKING][FEDEX][EVENTI]', s.numero, e?.message) }

      } else if (tipo === 'dielle') {
        // DIELLE (aggregatore TWS, dentro BRT/GLS/UPS…): lo stato si legge da /extracking/trackingStatus
        // con la LDV (= tracking_number salvato alla creazione). username/password/ambiente arrivano dalla
        // join corrieri.credenziali. Lo stato si mappa sulla DESCRIZIONE (non sui 816 codici). Best-effort:
        // nessuna risposta = nessun aggiornamento (mai declassa), come per gli altri diretti.
        if (!s.tracking_number || !cred?.username || !cred?.password) return
        const { trackingDielle, mapStatoDielle } = await import('@/lib/dielle')
        const { stati, consegnata: dlConseg, eventi: dlEventi } = await trackingDielle(cred, String(s.tracking_number))
        for (const str of stati) {
          const m = mapStatoDielle(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        if (dlConseg && prioritaStato('consegnata') > prioritaStato(nuovo)) nuovo = 'consegnata'
        if (stati.some((str) => mapStatoDielle(str) === 'in_giacenza')) vistaGiacenza = true
        // ...ma se il pacco e' tornato al mittente, quella "consegnata" e' il RITORNO: vince il reso.
        if (stati.some((str) => mapStatoDielle(str) === 'reso_mittente')) nuovo = 'reso_mittente'

        // CRONOLOGIA: trackingDielle torna gia' `eventi` {data:"DD-MM-YYYY HH:mm:ss", descrizione, luogo}.
        // La data italiana la gestisce istanteDaTesto (mai new Date(), che leggerebbe mese-giorno).
        try {
          const cambiatoDl = nuovo !== s.stato
          if (cambiatoDl || budgetCronologie > 0) {
            const { normalizzaEventi, scriviCronologia } = await import('@/lib/tracking-eventi')
            const { eventi, chiaviIgnote } = normalizzaEventi(dlEventi, {
              data: ['data', 'dataOra', 'datetime'],
              descrizione: ['descrizione'],
              luogo: ['luogo'],
            })
            if (chiaviIgnote.length && !chiaviEventoIgnote.length) chiaviEventoIgnote = chiaviIgnote
            if (eventi.length) {
              if (!cambiatoDl) budgetCronologie--
              await scriviCronologia(admin, s.id, eventi)
            }
          }
        } catch (e: any) { console.error('[TRACKING][DIELLE][EVENTI]', s.numero, e?.message) }

      } else {
        return
      }

      const upd: any = {}
      // Lo stato avanza SOLO IN AVANTI ('annullata' sempre applicata): il corriere può essere
      // "indietro" rispetto a noi (es. 'spedita' dopo la distinta mentre lui dice ancora
      // "in lavorazione") e NON deve declassare. Era la causa dei badge che regredivano.
      // RESO APPICCICOSO: se e' 'reso_mittente', la 'consegnata' del corriere e' la consegna del
      // RITORNO al mittente -> NON e' una consegna al destinatario, lo stato resta reso.
      // UNICA ECCEZIONE AL "SOLO IN AVANTI": il RESO. Il pacco rifiutato torna indietro e il ritorno
      // si chiude con una "consegnata" — che e' la consegna AL MITTENTE. Chi era gia' segnato
      // consegnato va quindi CORRETTO all'indietro, se no il reso non si addebita mai alla rete
      // (231 spedizioni cosi' al 17/09/2026, di cui 2 sole addebitate).
      if (nuovo && nuovo !== s.stato
          && (nuovo === 'annullata' || nuovo === 'reso_mittente' || prioritaStato(nuovo) > prioritaStato(s.stato))
          && !(s.stato === 'reso_mittente' && nuovo === 'consegnata')) upd.stato = nuovo
      // GIACENZA: si registra se l'abbiamo VISTA (vedi `vistaGiacenza` sopra), non solo quando vince
      // la classifica degli stati. SOLO SE IL PACCO E' ANCORA FERMO, pero': qui la data sarebbe
      // "adesso" e non quella vera (la porta solo il webhook, col campo `opened_at`), quindi su un
      // pacco gia' consegnato o reso si scriverebbe una giacenza con data falsa — e si farebbe
      // partire un addebito per una giacenza finita chissa' quando. Il recupero di quelle passate e'
      // una decisione a parte, non un effetto collaterale del cron.
      const fermo = s.stato !== 'consegnata' && s.stato !== 'reso_mittente' && s.stato !== 'annullata'
      if ((vistaGiacenza || nuovo === 'in_giacenza') && !s.giacenza_data && fermo) {
        // ...E SOLO SE E' APERTA ADESSO. `vistaGiacenza` dice che una giacenza c'e' stata, non che ci
        // sia ancora. Misurato il 18/09 PRIMA che il cron la usasse: su 438 pacchi fermi con una
        // giacenza nella cronologia, solo 115 avevano la giacenza come ULTIMO evento; 122 si erano gia'
        // mossi dopo (ripartiti, in consegna, consegnati) e 173 erano fermi da settimane su eventi non
        // riconosciuti. Aprirli tutti avrebbe addebitato giacenze gia' finite.
        // Se lo stato del corriere e' gia' 'in_giacenza' basta quello; altrimenti decide l'ultimo
        // evento della cronologia. Una "mancata consegna" arrivata DOPO la giacenza non basta: non e'
        // certo che il pacco sia tornato in giacenza, e qui si apre solo cio' che e' sicuro.
        let apertaAdesso = nuovo === 'in_giacenza'
        if (!apertaAdesso) {
          const { data: ult } = await admin.from('tracking_events').select('stato,descrizione')
            .eq('spedizione_id', s.id).order('data_evento', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
          apertaAdesso = (ult as any)?.stato === 'in_giacenza' || /giacenz/i.test(String((ult as any)?.descrizione || ''))
        }
        if (apertaAdesso) upd.giacenza_data = new Date().toISOString()
      }
      if (motivoGiacenza && motivoGiacenza !== (s as any).giacenza_motivo) upd.giacenza_motivo = motivoGiacenza
      if (nuovoTracking && nuovoTracking !== s.tracking_number) upd.tracking_number = nuovoTracking

      // RECUPERO NUMERO: alla creazione, se SpediamoPro/BRT non aveva ancora assegnato il tracking, il
      // numero è rimasto il codice interno (es. "6A5E..." o "SP-<id>"). Ora che il tracking reale c'è,
      // correggo il numero mostrato (così in elenco appare la LDV vera, non il codice interno).
      // 'DVA-<ordine>' e' il numero provvisorio del terzo provider, assegnato quando la lettera di
      // vettura non era ancora pronta: va sostituito appena arriva quella vera, come per 'SP-'.
      if (nuovoTracking && nuovoTracking !== s.numero && (s.numero === spCode || /^(SP|DVA|TMP)-/.test(String(s.numero || '')))) {
        upd.numero = nuovoTracking
      }

      // RECUPERO ETICHETTA: se l'etichetta non è mai stata salvata (il completamento in background prova
      // solo ~20s, ma BRT Express a volte genera dopo minuti/ore) e ora c'è un tracking → la scarico UNA
      // volta e la salvo. Così il download è immediato e non dipende più dal fallback on-demand.
      if (tipo === 'spediamopro' && senzaEtichetta.has(s.id) && spAuth && spId && (nuovoTracking || s.tracking_number)) {
        try {
          const lb = await spediamoproGetLabel(spAuth, spId, 1, 0)
          const norm = await normalizzaEtichetta(lb)
          upd.etichetta_url = `data:${norm.mime};base64,${norm.buffer.toString('base64')}`
        } catch { /* non ancora pronta: riprovo al giro dopo */ }
      }
      // Stessa rete di sicurezza per il terzo provider: li' l'etichetta nasce da una chiamata a
      // parte (getwaybill) e alla creazione puo' non essere ancora disponibile.
      // Manca il CODICE DEL RITIRO? Il corriere lo assegna anche minuti dopo aver accettato
      // l'ordine (nel frattempo al suo posto risponde "Not available"), quindi ne' la creazione
      // ne' il completamento in background riescono sempre a prenderlo. Questa e' la rete di
      // sicurezza definitiva: finche' manca, a ogni giro si riprova — e quando arriva finisce
      // anche sulla riga in Ritiri, che e' quella che l'utente guarda.
      // Limite di 3 giorni: se dopo tre giorni il codice non c'e', non arrivera' piu' — e senza
      // questo paletto ogni giro riscaricherebbe l'etichetta di quella spedizione per sempre.
      const eta = Date.now() - new Date(String((s as any).created_at || 0)).getTime()
      const ritiroSenzaCodice = tipo === 'easyparcel' && !!(s as any).richiedi_ritiro
        && !(s as any).ep_ritiro && eta < 3 * 24 * 3600 * 1000
      if (tipo === 'easyparcel' && (senzaEtichetta.has(s.id) || ritiroSenzaCodice) && (s as any).ep_ordine && cred?.apikey) {
        try {
          const { easyparcelWaybill } = await import('@/lib/easyparcel')
          const w = await easyparcelWaybill(cred.apikey, String((s as any).ep_ordine), 1, 0, false, 0, Number((s as any).colli) || 1)
          const b64 = w.singole[0]?.pdfBase64 || w.pdfBase64
          if (b64 && senzaEtichetta.has(s.id)) upd.etichetta_url = `data:application/pdf;base64,${b64}`
          if (w.numero && w.numero !== s.tracking_number) {
            upd.tracking_number = w.numero
            if (/^(TMP|DVA)-/.test(String(s.numero || ''))) upd.numero = w.numero
          }
          if (ritiroSenzaCodice && w.codiceRitiro) {
            // raw_response non e' in memoria (e' pesante e sta fuori dalla query apposta): lo si
            // rilegge solo per questa riga, che e' un caso raro.
            const { data: rr } = await admin.from('spedizioni').select('raw_response').eq('id', s.id).maybeSingle()
            upd.raw_response = { ...((rr?.raw_response as any) || {}), _codiceRitiro: w.codiceRitiro }
            if ((s as any).ritiro_id) {
              await admin.from('ritiri')
                .update({ cod_ritiro: w.codiceRitiro, tracking_ritiro: w.codiceRitiro })
                .eq('id', (s as any).ritiro_id)
            }
          }
        } catch { /* non ancora pronta: riprovo al giro dopo */ }
      }

      // AUTO-PULIZIA DEL TRACKING "COMPOSITO" (quirk SpediamoPro Poste). Alla creazione il provider a
      // volte restituisce il tracking SPORCO = <code interno>+<LDV vera> (es. "07WFM2EEW1UW07WF403279");
      // poco dopo lo pulisce, ma uno dei due campi resta sulla forma sporca → numero e tracking_number
      // divergono, con la LDV vera come SUFFISSO comune. Qui, SOLO quando un campo è suffisso dell'altro
      // (identica LDV, cambia solo il prefisso spurio), si allineano entrambi alla forma PULITA. La
      // guardia del suffisso è ciò che rende sicura questa pulizia: i casi a codici DAVVERO DISTINTI (es.
      // UPS che ri-emette l'etichetta all'Access Point: due 1Z diversi, nessuno suffisso dell'altro) NON
      // vengono toccati — lì non si può sapere a tavolino quale sia il buono. (16/09)
      {
        const a = String(upd.numero ?? s.numero ?? '')
        const b = String(upd.tracking_number ?? s.tracking_number ?? '')
        if (a && b && a !== b) {
          let pulito: string | null = null
          if (a.length > b.length && a.endsWith(b) && b.length >= 6) pulito = b
          else if (b.length > a.length && b.endsWith(a) && a.length >= 6) pulito = a
          if (pulito) { upd.numero = pulito; upd.tracking_number = pulito }
        }
      }

      if (Object.keys(upd).length) {
        await admin.from('spedizioni').update(upd).eq('id', s.id)
        aggiornate++
        // Se il NUMERO è cambiato, la descrizione dei movimenti cita ancora la forma vecchia: la
        // riallineo (solo il testo, mai importi/date). Scatta di rado, non appesantisce il giro.
        if (upd.numero && s.numero && upd.numero !== s.numero) {
          const { data: mv } = await admin.from('movimenti').select('id,descrizione').eq('spedizione_id', s.id)
          for (const m of (mv || [])) {
            const t = String((m as any).descrizione || '')
            if (t.includes(s.numero)) await admin.from('movimenti').update({ descrizione: t.split(s.numero).join(upd.numero) }).eq('id', (m as any).id)
          }
        }
      }

      // AUTO-ANNULLO DEL CORRIERE = ANCHE STORNO DEL CREDITO.
      // Se il corriere cancella la spedizione (es. SpediamoPro status 0: LDV async mai assegnata,
      // tipico sulle internazionali BRT Europa) qui si aggiornava SOLO lo stato ad 'annullata' e il
      // cliente restava ADDEBITATO per un pacco mai partito — segnalato da un cliente ("cancellate da
      // sole, riaccreditatemi"). Ora, sulla transizione verso annullata, si restituisce il credito a
      // cascata (cliente + master), come l'annullo manuale. rimborsaAnnulloSpedizione e' idempotente
      // (salta se esiste gia' un 'rimborso'): niente doppio storno con annullamenti-cron/annullo manuale.
      if (upd.stato === 'annullata' && s.stato !== 'annullata') {
        try { await rimborsaAnnulloSpedizione(admin, s as any, null) }
        catch (e: any) { console.error('[TRACKING][AUTO-ANNULLO] storno non riuscito', (s as any).numero, e?.message) }
      }

      // WEBHOOK AL CLIENTE quando lo stato CAMBIA DAVVERO.
      // Chi si integra puo' registrare tracking.updated / tracking.delivered /
      // tracking.exception, ma finora quelle notifiche partivano da un solo punto: la GET del
      // tracking, cioe' solo se era il cliente stesso a interrogarci. Il giro che aggiorna
      // davvero gli stati — questo — non ne mandava nessuna. Risultato: per sapere di una
      // consegna il cliente doveva fare polling su ogni spedizione, esattamente cio' che il
      // webhook serve a evitare. Best-effort: non blocca ne' fa fallire il giro.
      if (upd.stato) await notificaCambioStato(admin, s.id, upd.stato, s.stato)

      // L'apertura giacenza non si addebita piu' da qui: la registra il database da solo (trigger
      // trg_giacenza_da_addebitare) appena una spedizione entra in giacenza, da qualunque strada.
      // Qui sotto, fuori dal ciclo, si svuota quella coda. Prima l'addebito stava dietro a QUESTA
      // porta soltanto, e le giacenze scoperte dal webhook del corriere non le pagava nessuno.
    } catch { errori++ }
  }

  // Batch PARALLELI (16 alla volta) + ROTAZIONE: dopo ogni batch marco tracking_check_at, così
  // chi è stato controllato va in fondo alla coda e il giro dopo parte da chi aspetta da più
  // tempo. Anche se il run viene ucciso dal timeout a metà, la rotazione resta EQUA: nessuna
  // spedizione può restare indietro per sempre (era il bug "si aggiorna solo al click").
  const lista = spedizioni
  const BATCH = 16
  const inizioMs = Date.now()
  for (let i = 0; i < lista.length; i += BATCH) {
    const gruppo = lista.slice(i, i + BATCH)
    await Promise.all(gruppo.map(lavora))
    try { await admin.from('spedizioni').update({ tracking_check_at: new Date().toISOString() }).in('id', gruppo.map((g: any) => g.id)) } catch {}
    // margine di sicurezza sotto il maxDuration (300s): meglio fermarsi puliti che essere uccisi
    if (Date.now() - avvioMs > 270000) break
  }

  // GLI ADDEBITI (aperture giacenza e resi) NON SI FANNO PIU' QUI: li fa /api/cron/addebiti-code, un giro
  // a parte ogni 10 minuti. Stavano in fondo a questo giro e vivevano dei suoi avanzi di tempo — il
  // 18/09 due giri di fila si sono fermati a meta' coda e i resi non sono stati toccati. Le code le
  // riempie il database coi trigger; qui si aprono le giacenze, la' si addebitano. Un solo consumatore:
  // rimettere qui un blocco che le svuota vorrebbe dire rischiare di addebitare due volte.

  console.log(`[TRACKING] esaminate=${lista.length} aggiornate=${aggiornate} errori=${errori} durata=${Math.round((Date.now() - avvioMs) / 1000)}s`)
  // IL NOME DEL CAMPO DATA DEGLI EVENTI non e' documentato nella sezione tracking del provider: si
  // provano `data` (la forma usata da getorder e listorder nella stessa API) e le varianti note. Se
  // NESSUNA risponde, gli eventi vengono scartati invece di ricevere una data inventata — e qui si
  // stampano le chiavi VERE, cosi' la cosa si chiude al primo giro invece di restare un mistero.
  if (chiaviEventoIgnote.length) {
    console.error('[TRACKING][EP][EVENTI] nessun campo data riconosciuto. Chiavi presenti nell\'evento:',
      chiaviEventoIgnote.join(', '))
  }
  return NextResponse.json({ ok: true, esaminate: lista.length, aggiornate, errori, cronologieDaRecuperare: budgetCronologie <= 0, durataSec: Math.round((Date.now() - inizioMs) / 1000) })
}
