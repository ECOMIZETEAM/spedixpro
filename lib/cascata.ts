import { calcolaPrezzoListino, calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'
import { registraMovimentoMaster, descrizioneSpedizione } from '@/lib/movimenti'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { corriereDiMasterPerNome, detentoreContratto } from '@/lib/contratto-per-nome'
import { pesoSuReale } from '@/lib/agevolazione-misure'

export type LivelloCatena = {
  masterId: string
  nome: string
  tipoContratto: string
  credito: number
  prezzo: number
  isProprietario: boolean
  // La zona con cui e' stato calcolato QUESTO livello. Serve a confrontarla con quella del prezzo
  // al cliente: sulla stessa spedizione devono essere la stessa, altrimenti qualcuno sta comprando
  // isola e vendendo pianura.
  zona?: string
  // Questo livello e' il DETENTORE di un contratto SUO (proprio, non-vertice). Sui contratti propri
  // il master paga il corriere per conto suo: NON si addebita il nolo e NON si blocca sul credito
  // (al suo posto MoovExpress addebita la commissione fissa, via trigger). L'addebito spedizione e il
  // controllo credito saltano questo livello; le RIPESATURE no (usano la stessa catena ma per loro
  // il detentore-proprio paga comunque il riprezzo al corriere).
  pagaDalSuoConto?: boolean
  // Contrassegno/assicurazione RICHIESTI ma NON prezzati (o oltre il massimo) sul listino di QUESTO
  // livello: il suo costo non li conterrebbe. Su un rivenditore significa che venderebbe al cliente un
  // servizio che non ha prezzato in acquisto e la differenza la assorbirebbe il detentore (che il costo
  // reale col contrassegno lo paga sempre). Popolati solo quando il livello è prezzato dal suo listino
  // corrieri (non dal ripiego calcolaPrezzoListino, che non li espone): undefined = non pervenuto.
  contrassegnoOltreMax?: boolean
  assicurazioneOltreMax?: boolean
}

// ESPORTATA perche' serve anche a RIPREZZARE.
//
// Quando il fornitore ci ripesa un collo, ogni livello va riprezzato con le misure vere. Il prezzo
// nuovo deve uscire dalla STESSA funzione che ha fatto l'addebito originale: se lo ricalcolassi
// altrove con una copia della logica, le due si allontanerebbero al primo ritocco e la rettifica
// direbbe una cifra che non e' la differenza fra due prezzi confrontabili.
// Non scrive niente: costruisce la catena e i prezzi, e basta.
export async function costruisciCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    costoSpedizione: number
    provincia: string
    packages: any[]
    // OBBLIGATORI. Il comune serve per i CAP condivisi (25050 Rodengo Saiano vs Monte Isola):
    // senza, la zona che rivendica il CAP "solo per QUEL comune" vince comunque, e il master paga
    // la tariffa isola per un posto che isola non e'. Vedi la nota su verificaCreditoCatena.
    cap: string
    citta: string
    paese?: string
    // Nome contratto del corriere: i sotto-master rivendono con COPIE dello stesso corriere.
    // Serve per (1) trovare il proprietario REALE del contratto e (2) prezzare il corriere giusto.
    corriereNome?: string
    contrassegno?: number
    assicurazione?: number
    // SOLO ricalcolo RETTIFICHE: forza la stessa fascia (di norma 'Italia') su TUTTI i livelli della
    // catena, così non si mescolano zone diverse (MULTI su SCS, Ecomize su Italia). Default assente.
    zonaForzata?: string
    // MITTENTE (partenza): per il supplemento "zona mittente disagiato". Va a OGNI livello, perché è
    // un costo reale del corriere che ogni livello paga. Assente = nessun supplemento (invariato).
    mittCap?: string
    mittProvincia?: string
    mittPaese?: string
  }
): Promise<{ catena: LivelloCatena[]; errore?: string }> {
  const catena: LivelloCatena[] = []
  let currentId: string | null = params.masterDirettoId
  // RLS: la catena e' cross-tenant per natura -> client admin (auth verificata a monte)
  const adminDb = createAdminSupabase()

  // Proprietario REALE del contratto: il master più IN ALTO che possiede questo stesso corriere
  // (stesso nome_contratto). Chi spedisce usa una COPIA del corriere, ma il costo reale dell'API
  // lo paga il proprietario del contratto; i livelli sotto pagano il loro prezzo di rivendita.
  // Il vertice della catena: chi sta attaccato alla piattaforma non ha un master a cui deve, quindi
  // per lui i due conti non esistono e resta tutto su quello unico.
  const { data: radice }: any = await adminDb.from('masters').select('id').is('parent_master_id', null).limit(1).maybeSingle()
  const radiceId: string | null = radice?.id || null

  // IL DETENTORE SI DICHIARA (copia marcata `proprio`), altrimenti è il più in alto che ha lo stesso
  // contratto. La regola sta in lib/contratto-per-nome.ts: la usa anche l'anticipo dei contrassegni.
  const { detentore: ownerReale, dichiaratoProprio: contrattoDichiaratoProprio } =
    await detentoreContratto(adminDb, params.corriereOwnerId, params.corriereNome)

  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m }: any = await adminDb
      .from('masters')
      .select('id,nome,tipo_contratto,credito,credito_proprio,parent_master_id,parent_listino_id')
      .eq('id', currentId).single()
    if (!m) {
      return { catena, errore: 'Catena master non leggibile: impossibile verificare i livelli.' }
    }

    const isProprietario = m.id === ownerReale
    let prezzo = 0

    // Ogni master (a QUALSIASI livello) paga il SUO Listino Corrieri per questo corriere:
    // è il costo che vede nella sua lista movimenti.
    let calcolato = false
    let zonaLivello: string | undefined
    let codOltreMax: boolean | undefined
    let assOltreMax: boolean | undefined
    if (params.corriereNome) {
      const mCorrId = await corriereDiMasterPerNome(adminDb, m.id, params.corriereNome)
      if (mCorrId) {
        const mCorr = { id: mCorrId }
        const pesoReale = (params.packages || []).reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
        // REGOLA AGEVOLAZIONE (Moove): il COSTO di questo livello segue il flag del FORNITORE (il
        // livello sopra che gli vende il contratto), non il suo. Es. Velox OFF → il suo sotto-master
        // paga OFF (volumetrico) anche se sul proprio ha messo ON; l'ON del sotto-master vale solo per
        // cosa regala ai SUOI clienti (prezzo cliente, calcolato a parte), e se lo assorbe lui.
        // Il detentore NON entra qui (paga il provider col suo flag). Se non leggo il fornitore, resto
        // sul comportamento normale (nessun override → il livello usa il proprio flag come prima).
        let pesoSuRealeCost: boolean | undefined = undefined
        if (!isProprietario && m.parent_master_id) {
          const supCorrId = await corriereDiMasterPerNome(adminDb, m.parent_master_id, params.corriereNome)
          if (supCorrId) {
            const [supCorrRes, supListRes]: any = await Promise.all([
              adminDb.from('corrieri').select('settings').eq('id', supCorrId).maybeSingle(),
              adminDb.from('listini_corrieri').select('solo_peso_reale').eq('master_id', m.parent_master_id).eq('corriere_id', supCorrId),
            ])
            const supSolo = (supListRes?.data || []).some((l: any) => l.solo_peso_reale)
            pesoSuRealeCost = pesoSuReale(supCorrRes?.data?.settings || {}, params.packages, pesoReale, supSolo)
          }
        }
        const pz = await calcolaPrezzoCorriereDettaglio(adminDb, {
          corriereId: mCorr.id, masterId: m.id,
          provincia: params.provincia, cap: params.cap, paese: params.paese, citta: params.citta,
          pesoReale, packages: params.packages,
          contrassegno: params.contrassegno, assicurazione: params.assicurazione,
          zonaForzata: params.zonaForzata,
          pesoSuRealeCost,
          mittCap: params.mittCap, mittProvincia: params.mittProvincia, mittPaese: params.mittPaese,
        })
        if (pz != null) { prezzo = pz.totale; zonaLivello = pz.zona; calcolato = true; codOltreMax = pz.contrassegnoOltreMax; assOltreMax = pz.assicurazioneOltreMax }
      }
    }
    // Fallback se il master non ha il listino corrieri per questo contratto:
    // il proprietario reale usa il costo reale dell'API; gli altri il listino assegnato dal padre.
    if (!calcolato) {
      if (isProprietario) {
        prezzo = Number(params.costoSpedizione || 0)
      } else {
        if (!m.parent_listino_id) {
          return { catena, errore: `Il master "${m.nome}" non ha un listino corrieri né un listino assegnato.` }
        }
        // IL RIPIEGO SUL LISTINO DEL PADRE DEVE PREZZARE QUESTO CONTRATTO, NON IL PIU' ECONOMICO.
        // Senza corriereId, calcolaPrezzoListino sceglie la tariffa piu' bassa di TUTTO il listino: una
        // spedizione Poste Express M il cui contratto NON copre la destinazione (es. il sotto-master non
        // prezza Venezia/Laguna → il suo listino corrieri la esclude, calcolato=false) finiva prezzata con
        // "ITALIA V" di Poste Business Express V a 3,40 €, mentre a MULTIEXPRESS quella spedizione costa
        // 12,63 €: la differenza la assorbiva il detentore, in silenzio (caso vero 3UW1UHA260742, Caorle VE;
        // ~1.275 € in 14 giorni). La guardia per-corriere ESISTE gia' in calcolaPrezzoListino ma scatta solo
        // se le passi il corriere. Il corriere da prezzare e' quello del PADRE che ha assegnato il listino
        // (le fasce di parent_listino usano il corriere del padre). Se quel contratto non prezza la
        // destinazione → niente tariffa → la catena si ferma qui: un sotto-master non rivende cio' che non ha.
        const corrPadre = params.corriereNome
          ? await corriereDiMasterPerNome(adminDb, m.parent_master_id, params.corriereNome)
          : null
        const ris = await calcolaPrezzoListino(adminDb, {
          listinoId: m.parent_listino_id, provincia: params.provincia,
          packages: params.packages, cap: params.cap, paese: params.paese, citta: params.citta,
          corriereId: corrPadre,
          zonaForzata: params.zonaForzata,
          mittCap: params.mittCap, mittProvincia: params.mittProvincia, mittPaese: params.mittPaese,
        })
        if (!ris) return { catena, errore: `Nessuna tariffa nel listino del master "${m.nome}".` }
        prezzo = ris.prezzo
        zonaLivello = ris.zona
      }
    }

    // IL SALDO DEL CONTO CHE PAGHERA' DAVVERO.
    // Un master puo' avere due conti: quello verso il master sopra e quello dei contratti SUOI.
    // Il costo finisce sul secondo solo se ricorrono TRE cose insieme: questo livello e' il
    // detentore, il contratto e' DICHIARATO suo, e il master non e' un vertice (chi sta attaccato
    // alla piattaforma non deve niente a nessuno e ha un conto solo).
    // Guardare "sono il detentore" e basta sarebbe sbagliato: sui contratti della rete il detentore
    // e' il master in cima, che il conto proprio non ce l'ha — lo si vedrebbe a zero e si
    // bloccherebbero le spedizioni di tutti.
    const eVertice = !m.parent_master_id || m.parent_master_id === radiceId
    const pagaDalSuoConto = isProprietario && contrattoDichiaratoProprio && !eVertice
    catena.push({
      masterId: m.id, nome: m.nome,
      tipoContratto: m.tipo_contratto || 'credito_scalare',
      credito: Number((pagaDalSuoConto ? m.credito_proprio : m.credito) || 0),
      prezzo, isProprietario, zona: zonaLivello,
      pagaDalSuoConto,
      contrassegnoOltreMax: codOltreMax, assicurazioneOltreMax: assOltreMax,
    })

    if (isProprietario) break
    currentId = m.parent_master_id
  }

  // ── FLOOR ANTI-SOTTO-COSTO: SOLO SUL DETENTORE DEL CONTRATTO ──
  // Il costo reale del provider (`costoSpedizione` = quotation/shipmentCost per SpediamoPro/DVA/Spedisci)
  // lo paga materialmente CHI POSSIEDE il contratto: MULTIEXPRESS per i contratti di rete, o il master
  // stesso per i suoi contratti propri. Il suo movimento DEVE riflettere quanto ha pagato davvero, quindi
  // se il suo listino è più basso del costo reale si alza al costo reale.
  //
  // I master A VALLE, invece, pagano il LORO listino e basta. Se quel listino risulta sotto il costo reale
  // NON è una perdita da scaricare sul rivenditore: è il segnale che la piattaforma ha prezzato male quella
  // fascia (listino di rivendita al sub-master troppo basso, o peso volumetrico sottostimato rispetto a
  // quello con cui il provider fattura). Il DETENTORE del contratto assorbe la differenza e la vede nel suo
  // margine → così capisce che deve correggere il prezzo. Livellare anche i sub-master al costo reale
  // spostava la perdita sul rivenditore e gli faceva pagare PIÙ del suo listino ("ho 5€ sulla fascia ma
  // ne pago 6?"). Deciso 16/09 su segnalazione: "il contratto è del detentore, solo lui deve vedere il
  // costo DVA; gli altri pagano il loro listino". NON tocca i clienti (calcolati a parte).
  const costoReale = Number(params.costoSpedizione || 0)
  if (costoReale > 0) {
    for (let i = 0; i < catena.length; i++) {
      if (catena[i].isProprietario && catena[i].prezzo < costoReale - 0.005) {
        console.warn('[CATENA][SOTTO-COSTO] detentore livellato al COSTO REALE del provider', {
          contratto: params.corriereNome, master: catena[i].nome,
          prezzo_calcolato: catena[i].prezzo, costo_reale: costoReale, delta: Math.round((costoReale - catena[i].prezzo) * 100) / 100,
        })
        catena[i].prezzo = costoReale
      }
    }
  }

  return { catena }
}

// UN MASTER HA DAVVERO DUE CONTI?
// Stessa condizione che qui sopra decide su quale conto finisce il costo, tenuta in una funzione
// sola: se un giorno cambia, cambia insieme per il controllo del credito e per le pagine. Metterla
// anche nelle pagine "tanto e' facile" e' esattamente il modo in cui le due si allontanano.
// I clienti non c'entrano: hanno un conto solo e devono al proprio master comunque.
export async function haContoProprio(masterId: string | null | undefined): Promise<boolean> {
  if (!masterId) return false
  // Letture minime e sul master di chi sta guardando: serve l'accesso pieno perche' la radice
  // della piattaforma non e' nella rete di chi interroga e con le sole regole per-inquilino
  // tornerebbe vuota — e un vertice si vedrebbe un secondo conto che non ha.
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', masterId).maybeSingle()
  if (!m?.parent_master_id) return false
  const { data: radice } = await admin.from('masters').select('id').is('parent_master_id', null).maybeSingle()
  if (radice?.id && m.parent_master_id === radice.id) return false
  const { count } = await admin.from('corrieri')
    .select('id', { count: 'exact', head: true }).eq('master_id', masterId).eq('proprio', true)
  return (count || 0) > 0
}

// IL CAP E IL COMUNE SONO OBBLIGATORI, e non e' pignoleria.
//
// Erano facoltativi, e la porta delle API si era dimenticata `citta`: compilava benissimo. Dentro
// la stessa richiesta il cliente veniva prezzato col comune e i master addebitati senza — e senza
// comune la zona speciale che rivendica un CAP "ma solo per QUEL comune" vince lo stesso. Il master
// pagava la tariffa isola per destinazioni che isola non sono: Ficarazzi al posto di Ustica,
// Bacoli al posto di Ischia. 162,37 euro presi di troppo a quattro master in tre settimane, e
// nessun errore da nessuna parte.
//
// Renderli obbligatori sposta il controllo dove passano tutte le porte: una rotta nuova che se li
// dimentica NON COMPILA. E' l'unica versione di questa regola che non si puo' dimenticare.
export async function verificaCreditoCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    provincia: string
    cap: string
    citta: string
    packages: any[]
    costoSpedizione?: number
    paese?: string
    corriereNome?: string
    contrassegno?: number
    assicurazione?: number
    // La zona e il prezzo con cui e' stato calcolato il CLIENTE. Servono al controllo qui sotto.
    zonaCliente?: string
    prezzoCliente?: number
    // MITTENTE (partenza): supplemento zona mittente disagiato. Assente = nessun supplemento.
    mittCap?: string
    mittProvincia?: string
    mittPaese?: string
  }
): Promise<{ ok: boolean; errore?: string; masterInsufficiente?: string; servizioNonPrezzato?: boolean }> {
  const { catena, errore } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione || 0,
    provincia: params.provincia,
    packages: params.packages,
    cap: params.cap,
    paese: params.paese,
    citta: params.citta,
    corriereNome: params.corriereNome,
    contrassegno: params.contrassegno,
    assicurazione: params.assicurazione,
    mittCap: params.mittCap, mittProvincia: params.mittProvincia, mittPaese: params.mittPaese,
  })
  if (errore) return { ok: false, errore }

  // ── DUE ZONE SULLA STESSA SPEDIZIONE: NON SI PARTE ──
  //
  // E' il guasto che continua a tornare sotto nomi diversi. Su una spedizione per Vulcano Porto il
  // prezzo al cliente ha risolto "Italia" (4,70) e il costo del suo master "Isole Minori" (10,10):
  // stessa destinazione, stesso contratto, due zone. Il master ha comprato isola e venduto pianura,
  // 5,40 di perdita secca, e nessuno se n'e' accorto fino a quando il cliente non si e' lamentato.
  // Le cause sono state di volta in volta diverse — il comune non passato alla cascata, il comune
  // scritto in modo che non combacia con l'elenco della zona, gli elenchi disallineati fra il
  // listino del cliente e quello del master — ma il SINTOMO e' sempre lo stesso, ed e' questo.
  //
  // Quindi si controlla il sintomo, non le cause: se il cliente paga MENO di quanto costa al suo
  // master diretto E le due cifre vengono da zone diverse, la spedizione non nasce.
  //
  // Le due condizioni servono tutte e due, e nessuna basta da sola:
  //  - solo "paga meno del costo" bloccherebbe i listini volutamente sotto costo, che esistono e
  //    sono una scelta di chi li fa (ci si era gia' provato, e i falsi positivi lo fecero togliere);
  //  - solo "zone diverse" bloccherebbe i casi innocui, tipo un listino che chiama "SCS" quello che
  //    un altro chiama "Italia" con gli stessi identici prezzi: nomi diversi, nessuna perdita.
  // Insieme descrivono esattamente il danno: sto vendendo sotto costo PERCHE' ho letto un'altra
  // zona. Meglio un errore chiaro adesso che una perdita silenziosa da spiegare a fine mese.
  const diretto = catena[0]
  if (params.zonaCliente && diretto?.zona && params.prezzoCliente != null) {
    const zoneDiverse = String(params.zonaCliente).trim().toUpperCase() !== String(diretto.zona).trim().toUpperCase()
    const sottoCosto = Number(params.prezzoCliente) < diretto.prezzo - 0.01
    if (zoneDiverse && sottoCosto) {
      return {
        ok: false,
        errore: `Destinazione fuori zona: al cliente risulta "${params.zonaCliente}" (€ ${Number(params.prezzoCliente).toFixed(2)}) ma per il contratto e' "${diretto.zona}" (€ ${diretto.prezzo.toFixed(2)}). Spedizione non creabile: allinea la zona sul listino del cliente, oppure scegli un altro corriere.`,
      }
    }
  }

  // ── CONTRASSEGNO / ASSICURAZIONE VENDUTI MA NON PREZZATI IN ACQUISTO ──
  // Come una zona senza prezzo (REGOLE.md §1: "il corriere va escluso, non venduto"): se il
  // contrassegno (o l'assicurazione) è richiesto ma un RIVENDITORE della catena non lo prezza sul
  // proprio listino corrieri, il suo costo non lo conterrebbe e la differenza la assorbirebbe il
  // detentore — che il costo reale col contrassegno lo paga sempre (è successo a MULTIEXPRESS sul
  // contratto DVA: il sub vendeva il COD al cliente senza averlo in acquisto, e il floor alzava il
  // detentore al costo reale a sua perdita). Il DETENTORE si salta: il suo COD viene dal costo reale
  // del fornitore, non dal listino. `=== true` apposta: undefined (livello prezzato dal ripiego, che
  // non espone il flag) NON blocca, così non si fermano spedizioni che oggi passano.
  if ((params.contrassegno || 0) > 0 && catena.some(l => !l.isProprietario && l.contrassegnoOltreMax === true)) {
    return { ok: false, servizioNonPrezzato: true, errore: 'Contrassegno non disponibile su questo contratto per questa destinazione: rimuovilo o scegli un altro corriere.' }
  }
  if ((params.assicurazione || 0) > 0 && catena.some(l => !l.isProprietario && l.assicurazioneOltreMax === true)) {
    return { ok: false, servizioNonPrezzato: true, errore: 'Assicurazione non disponibile su questo contratto per questa destinazione: rimuovila o scegli un altro corriere.' }
  }

  for (const liv of catena) {
    // Contratti PROPRI: non si bloccano mai (il master paga il corriere per conto suo).
    if (liv.pagaDalSuoConto) continue
    if (liv.tipoContratto === 'credito_scalare' && liv.prezzo > 0 && liv.credito < liv.prezzo) {
      // masterInsufficiente = chi è a secco: il chiamante decide se mostrarne il dettaglio
      // (solo al diretto interessato) o un generico "Credito insufficiente" ai livelli sotto.
      return {
        ok: false,
        errore: `Credito insufficiente: "${liv.nome}" ha € ${liv.credito.toFixed(2)} ma servono € ${liv.prezzo.toFixed(2)}.`,
        masterInsufficiente: liv.masterId,
      }
    }
  }
  return { ok: true }
}

export async function addebitaCatena(
  supabase: any,
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    costoSpedizione: number
    provincia: string
    packages: any[]
    numero: string
    destNome: string
    spedizioneId: string | null
    createdBy: string | null
    // Obbligatori: e' la riga che mancava proprio qui, chiamata dalle API. Vedi sopra.
    cap: string
    citta: string
    paese?: string
    corriereNome?: string
    contrassegno?: number
    assicurazione?: number
    mittCap?: string
    mittProvincia?: string
    mittPaese?: string
  }
): Promise<void> {
  const adminMov = createAdminSupabase()
  const { catena } = await costruisciCatena(supabase, {
    masterDirettoId: params.masterDirettoId,
    corriereOwnerId: params.corriereOwnerId,
    costoSpedizione: params.costoSpedizione,
    provincia: params.provincia,
    packages: params.packages,
    cap: params.cap,
    paese: params.paese,
    citta: params.citta,
    corriereNome: params.corriereNome,
    contrassegno: params.contrassegno,
    assicurazione: params.assicurazione,
    mittCap: params.mittCap, mittProvincia: params.mittProvincia, mittPaese: params.mittPaese,
  })

  for (const liv of catena) {
    if (!(liv.prezzo > 0)) continue
    // CONTRATTI PROPRI: il COSTO (nolo) del detentore SI registra, sul suo conto proprio — cosi' vede
    // quanto gli costa il corriere e il suo margine, come il vertice (MULTIEXPRESS) e come funzionava
    // prima del 17/08. Il movimento e' taggato conto='proprio' da fn_conto_di, quindi
    // registra_movimento_master scala `credito_proprio` (conto di TRACCIA, mai ricaricato) e NON il
    // credito prepagato della rete: il master paga il corriere per conto suo, questo e' solo il registro
    // del suo costo. E NON blocca la spedizione: verificaCreditoCatena salta i livelli pagaDalSuoConto.
    // MoovExpress incassa comunque la commissione fissa (trigger fee su spedizioni), che resta a parte.
    // (Il 17/08 un salto aveva spento questa traccia lasciando solo la commissione; ripristinato il
    //  22/09 con l'owner: il detentore deve vedere il suo costo, non €64 di sole commissioni.)
    try {
      await registraMovimentoMaster(adminMov, {
        masterOwnerId: liv.masterId,
        masterTargetId: liv.masterId,
        tipo: 'spedizione',
        descrizione: descrizioneSpedizione(params.numero, params.destNome),
        riferimento: params.numero,
        importo: -Math.abs(liv.prezzo),
        spedizioneId: params.spedizioneId,
        createdBy: params.createdBy,
      })
    } catch (e) {
      console.error(`Errore addebito cascata su master ${liv.masterId}:`, e)
    }
  }
}
// NOTA: qui c'era `rimborsaCatena`, tolta il 6 agosto.
//
// Non la chiamava NESSUNO — un solo riferimento in tutto il progetto, la sua stessa definizione —
// ed era una seconda strada per fare una cosa che si fa gia' altrove in modo piu' sicuro. Gli
// annulli stornano da lib/annullaSpedizione.ts, che ROVESCIA I MOVIMENTI REALMENTE REGISTRATI;
// questa invece ricalcolava il rimborso dal listino. Le due cose coincidono solo finche' il
// listino non cambia e finche' entrambe risolvono la stessa zona — cioe' non sempre, come si e'
// visto proprio oggi con il comune mancante. Una funzione che restituisce soldi con un conto
// diverso da quello con cui li ha presi non e' una comodita': e' una trappola che aspetta il
// primo che la chiama.
