import { calcolaPrezzoListino, calcolaSupplementiCliente, calcolaPesoFatturato, fattoreVolumeCorriere, calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'
import { costruisciCatena } from '@/lib/cascata'
import { catenaDaCorriere } from '@/lib/condivisione-catena'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'
import { colliDettaglioOEredita } from '@/lib/colli-dettaglio'
import type { Ripesatura } from '@/lib/ripesature'

// COSA DEVE PAGARE OGNUNO, DOPO CHE IL FORNITORE HA RIMISURATO IL COLLO.
//
// L'importo del file NON scende lungo la catena. Quello e' il costo del DETENTORE del contratto:
// se al detentore la ripesatura costa 1 euro, al cliente finale puo' costarne 2,70, perche' ogni
// livello ha il suo listino e le sue fasce. Quindi non si passa una cifra, si RIPREZZA il collo
// vero a ogni livello.
//
// SI RIPREZZA CON LE MISURE, NON COL SOLO PESO. Il supplemento lo fa il VOLUME: verificato
// chiedendo al fornitore due preventivi sulla stessa spedizione, 106 casi su 106 al centesimo, e su
// 45 di quei 106 il pacco pesava MENO di quanto avevamo fatturato e pagava lo stesso, perche'
// misurava di piu'. Il caricamento rettifiche esistente passa il solo peso — c'e' scritto
// "senza misure: nessun volumetrico" — e con quello la meta' delle righe verrebbe fuori NEGATIVA.
//
// IL "PRIMA" E' QUELLO PAGATO ALLORA, non un prezzo rifatto oggi. Le tariffe si muovono: su una
// spedizione del 1 agosto il preventivo rifatto il giorno 6 dava 4,81, ma allora era stata pagata
// 5,97, e solo col valore storico la differenza tornava esatta. Quindi il confronto e'
// "prezzo nuovo col collo vero" meno "quello che risulta addebitato nei movimenti".

export type LivelloRettifica = {
  chi: string                  // nome del master, o ragione sociale del cliente
  clienteId: string | null
  masterId: string | null
  pagato: number               // quanto risulta addebitato nei movimenti
  dovuto: number | null        // quanto sarebbe col collo ripesato (null = non calcolabile)
  differenza: number | null
  // SOLO sui contratti condivisi: com'e' fatto il salto di questo master verso chi gli vende. Chi
  // scrive il movimento DEVE leggerlo: su un salto 'codice' i soldi stanno sul ledger presso il
  // fornitore, non sul conto verso il padre. La correzione peso/misure li indovinava dall'albero e il
  // 13/10 ha messo due rettifiche di 282343J006009 sui conti sbagliati (Wave e MULTIEXPRESS).
  ruolo?: 'albero' | 'codice' | 'owner'
  fornitore?: string | null
  ledgerClienteId?: string | null
}

export type EsitoRipesatura = {
  ldv: string
  idOrdine: string
  trovata: boolean
  motivo?: string
  spedizioneId?: string
  destinatario: string
  colli: number
  pesoPrima: number
  // Il collo come DICHIARATO alla creazione, per la colonna "iniziale" della tabella: il peso REALE
  // dichiarato e il suo VOLUMETRICO, in simmetria con pesoDopo/pesoVolumeDopo (ripesati). Prima si
  // scriveva peso_iniziale = peso_fatturato (il max, spesso il volume) e peso_volume_iniziale = 0:
  // la colonna "peso iniziale" mostrava il volume e "peso/volume iniziale" restava vuota.
  pesoRealePrima: number
  pesoVolumePrima: number
  pesoDopo: number
  pesoVolumeDopo: number   // peso VOLUMETRICO dopo la ripesatura: va mostrato accanto al reale
  misure: string
  addebitoFornitore: number
  livelli: LivelloRettifica[]
  // I master della catena, dal piu' basso al detentore del contratto. Serve a capire a chi va
  // indirizzata la rettifica: al FIGLIO DIRETTO di chi la sta caricando, non al fondo della catena.
  catenaDalBasso?: string[]
  // La catena e' stata ricostruita fino in fondo? Se si e' fermata a meta' (un livello senza
  // listino, una destinazione fuori tariffa) i livelli sopra quel punto MANCANO — e chi carica
  // rischia di non trovarsi dentro e di scambiare "non sono nella catena" per "sono l'ultimo".
  catenaCompleta?: boolean
  // IL COSTO DEL DETENTORE, a parte dai livelli. Chi ha il contratto proprio paga il fornitore da se':
  // quando carica le rettifiche del fornitore deve essere il PRIMO a pagarle, e solo dopo girarle
  // sotto (regola di Lorenzo, 22/10/2026). Nei file con l'importo del fornitore il suo costo e' quello;
  // nei file senza importo (XL di Poste, file pesi) e' il prezzo del SUO listino di costo al peso nuovo
  // meno quanto ha gia' pagato. Sta FUORI da `livelli` di proposito: i livelli li legge anche la modifica
  // spedizione, che addebita ogni livello — con il costo dentro, una modifica addebiterebbe il detentore.
  costoDetentore?: { masterId: string; pagato: number; dovuto: number; differenza: number } | null
  // I colli come li ha rimisurati il fornitore. Viaggiano con la rettifica perche' chi la ricevera'
  // dovra' riprezzarli col PROPRIO listino per girarli al livello sotto: la cifra in euro non
  // scende lungo la catena, e col solo peso il volume — che e' quello che fa il supplemento — si
  // perderebbe per strada.
  colli_ripesati?: { weight: number; length: number; width: number; height: number }[]
}

const arrotonda = (n: number) => Math.round(n * 100) / 100

// L'addebito di un livello non supera il salto fatto con lo stesso listino: dovuto sul ripesato meno
// dovuto sul dichiarato (vedi «LA RETTIFICA CONTA I CHILI» in calcolaRipesature). Il livello torna
// com'era quando non c'e' niente da limitare: nessun addebito, dichiarato non prezzabile, o un salto che
// supera gia' la differenza (listino sceso, o il livello aveva pagato di piu' alla partenza).
function soloIlSalto<T extends { pagato: number; dovuto: number | null; differenza: number | null }>(l: T, dovutoDichiarato: number | null | undefined): T {
  if (l.dovuto == null || l.differenza == null || l.differenza < 0.01 || dovutoDichiarato == null) return l
  const salto = Math.max(0, arrotonda(l.dovuto - dovutoDichiarato))
  if (salto >= l.differenza) return l
  return { ...l, dovuto: arrotonda(l.pagato + salto), differenza: salto } as T
}

// IL COLLO COME ERA STATO DICHIARATO, da prezzare col listino di oggi accanto a quello ripesato. Torna []
// quando non lo si conosce con certezza, e allora la rettifica resta com'era. Multicollo: dal dettaglio
// salvato, o dai `parcels` del fornitore (sui pacchi SpediamoPro `raw` e' una stringa JSON); mai la misura
// unica ripetuta per il numero dei colli, che su 050039152917364 (70×55×55 + 75×35×55) faceva 84,7 kg di
// volume invece dei 71,22 fatturati: un dichiarato gonfiato farebbe pagare meno chili di quelli veri.
// Lo stesso istante della Conferma (app/api/rettifiche/route.ts): da li' il prezzo si fa collo per collo.
const PREZZO_COLLO_PER_COLLO_DAL = Date.parse('2026-09-28T13:51:34Z')
function colliDichiarati(s: any, rawResponse: any): { weight: number; length: number; width: number; height: number }[] {
  const n = Math.max(1, Number(s.colli) || 1)
  if (n === 1) {
    const peso = Number(s.peso_reale) || 0
    return peso > 0 ? [{ weight: peso, length: Number(s.lunghezza) || 0, width: Number(s.larghezza) || 0, height: Number(s.altezza) || 0 }] : []
  }
  let raw = rawResponse
  if (typeof raw?.raw === 'string') { try { raw = JSON.parse(raw.raw) } catch { raw = null } }
  const dett = colliDettaglioOEredita(s.colli_dettaglio, raw)
  if (dett.length !== n) return []
  const colli = dett.map(c => ({ weight: Number(c.peso) || 0, length: Number(c.lunghezza) || 0, width: Number(c.larghezza) || 0, height: Number(c.altezza) || 0 }))
  // FINO AL 28/09/2026 (dc000a54) LE MULTICOLLO SI PAGAVANO SUI TOTALI, max(somma dei pesi, somma dei
  // volumi), e il dichiarato va prezzato come si e' pagato: collo per collo pesa sempre uguale o di piu',
  // e uno scalino vero sparirebbe. Un collo solo col peso e il volume di tutti da' lo stesso prezzo a
  // ogni livello, ciascuno col suo divisore; il lato lungo lo tiene fuori dalla scatola agevolata, che
  // sulle multicollo non vale.
  if (Date.parse(s.created_at) < PREZZO_COLLO_PER_COLLO_DAL) {
    const volume = colli.reduce((t, c) => t + (c.length && c.width && c.height ? c.length * c.width * c.height : 0), 0)
    const peso = colli.reduce((t, c) => t + c.weight, 0)
    return peso > 0 ? [{ weight: peso, length: volume, width: volume ? 1 : 0, height: volume ? 1 : 0 }] : []
  }
  return colli
}

// QUALCUNO SOTTO DEVE ANCORA PAGARE? Un livello puo' aver gia' pagato il giusto (differenza zero)
// mentre chi sta sotto di lui no: il cliente ha fasce piu' fitte, o il sotto-master all'origine aveva
// pagato meno di quanto pagava il suo padre. Se la rettifica si fermasse al livello a zero, chi sta
// sotto non potrebbe piu' chiedere niente ai suoi. Sul file di LOGIXIA del 12/10/2026: 319 spedizioni
// ferme gia' al primo passo (325,59 euro che i sotto-master non recuperavano dai loro clienti) e 3
// ferme a meta' catena. Scelta di Lorenzo (15/10): in questi casi la rettifica scende lo stesso, A
// ZERO per chi non deve niente, e chi sta sotto la riprezza col suo listino come le altre.
export function qualcunoSottoDeve(esito: EsitoRipesatura, figlio: string | null): boolean {
  if (!figlio) return false                       // il figlio e' il cliente: sotto non c'e' nessuno
  const cat = esito.catenaDalBasso || []
  const i = cat.indexOf(figlio)
  if (i < 0) return false
  const sotto = new Set(cat.slice(0, i))          // i master piu' in basso del figlio
  return (esito.livelli || []).some(l => l.differenza != null && l.differenza >= 0.01
    && (l.masterId ? sotto.has(l.masterId) : !!l.clienteId))
}

// QUANTE RIGHE ALLA VOLTA. Ogni riga e' un conto a se' e fa SOLO LETTURE (spedizione, movimenti,
// contratto, cliente, listini, catena): una non sa nulla dell'altra, quindi farne otto insieme non
// cambia un centesimo — cambia solo il tempo. Misurato il 29/09/2026 su 20 righe vere: 6,33 s a riga
// una alla volta, 0,93 s a riga a otto per volta (6,8 volte piu' veloce), con esiti IDENTICI riga per
// riga. E' il motivo per cui MULTIEXPRESS ci metteva mezz'ora a caricare mille lettere di vettura.
// SEDICI, non otto: rimisurato il 29/09/2026 sulle rettifiche vere di un sotto-master — 0,98 s a
// riga con otto, 0,60 con sedici, 0,59 con ventiquattro. Oltre sedici non si guadagna piu' niente
// (si fa solo la fila sulle connessioni del database), sotto si aspetta e basta.
const RIGHE_INSIEME = 16

export async function calcolaRipesature(admin: any, righe: Ripesatura[]): Promise<EsitoRipesatura[]> {
  // Il risultato torna NELLO STESSO ORDINE in cui sono arrivate le righe, anche se finiscono in
  // tempi diversi: chi legge si aspetta la riga 1 al posto 1.
  const out: EsitoRipesatura[] = new Array(righe.length)

  const elabora = async (r: Ripesatura): Promise<EsitoRipesatura> => {
    const base: EsitoRipesatura = {
      ldv: r.ldv, idOrdine: r.idOrdine, trovata: false, destinatario: r.destinatario,
      colli: r.colli.length,
      pesoPrima: 0,
      pesoRealePrima: 0, pesoVolumePrima: 0,
      pesoDopo: arrotonda(r.colli.reduce((s, c) => s + c.peso, 0)),
      pesoVolumeDopo: 0,
      misure: r.colli.map(c => `${c.lunghezza}x${c.larghezza}x${c.altezza}`).join(' + '),
      addebitoFornitore: r.addebitoFornitore,
      livelli: [],
    }

    const { data: legs } = await admin.from('spedizioni')
      .select('id,cliente_id,master_id,corriere_id,stato,created_at,peso_fatturato,peso_reale,peso_volume,lunghezza,larghezza,altezza,colli,colli_dettaglio,dest_provincia,dest_cap,dest_citta,dest_paese,mitt_cap,mitt_provincia,contrassegno,assicurazione,valore_merce,servizi_accessori,numero,tracking_number')
      .eq('tracking_number', r.ldv)
    // CONDIVISIONE: più gambe condividono il tracking; prendo l'ORIGINANTE (numero pulito = tracking, è
    // quella col cliente finale e la catena-fornitore giusta). Spedizione normale = una riga sola.
    const s: any = (legs || []).find((x: any) => x.numero === x.tracking_number) || (legs || [])[0] || null
    if (!s) return { ...base, motivo: 'spedizione non trovata' }
    if (s.stato === 'annullata') return { ...base, spedizioneId: s.id, motivo: 'spedizione annullata' }

    base.trovata = true
    base.spedizioneId = s.id
    base.pesoPrima = Number(s.peso_fatturato || 0)
    base.pesoRealePrima = Number(s.peso_reale || 0)
    base.pesoVolumePrima = Number(s.peso_volume || 0)

    // Il collo come lo ha misurato il fornitore, nella forma che vuole il motore dei prezzi.
    const packages = r.colli.map(c => ({
      weight: c.peso, length: c.lunghezza, width: c.larghezza, height: c.altezza,
    }))
    base.colli_ripesati = packages
    // IL VOLUME DOPO LA RIPESATURA. Serve perche' mostrare solo i 14 kg reali quando il volume ne fa
    // 50 fa sembrare la rettifica un furto (peso giu', costo su): il costo sale per il VOLUME, e va
    // scritto accanto al reale. Divisore = fattore del contratto (quello che il master ha impostato
    // per questo corriere). Per il cliente sotto lo si riprende esatto dal suo listino.
    try {
      const fatt = await fattoreVolumeCorriere(admin, s.master_id, s.corriere_id)
      const pv = calcolaPesoFatturato(packages, fatt).pesoVolume
      if (pv > 0) base.pesoVolumeDopo = arrotonda(pv)
    } catch { /* senza fattore il volume resta 0 */ }
    const dest = {
      provincia: s.dest_provincia || '', cap: s.dest_cap || '',
      citta: s.dest_citta || '', paese: s.dest_paese || 'IT',
      // MITTENTE della spedizione originale: il riprezzo deve includere lo stesso supplemento origine
      // usato alla creazione, altrimenti una ripesatura lo toglierebbe (differenza fasulla).
      mittCap: s.mitt_cap || '', mittProvincia: s.mitt_provincia || '', mittPaese: 'IT',
    }

    // Quanto risulta addebitato: dai MOVIMENTI, che sono l'unico posto dove c'e' scritto davvero.
    //
    // ANCHE LE RETTIFICHE GIA' FATTE CONTANO. Se questa spedizione e' gia' stata riprezzata una
    // volta — col file dei pesi o a mano — quell'addebito e' soldi che il cliente ha gia' pagato:
    // ignorarlo vorrebbe dire chiedergli una seconda volta la stessa differenza. Un addebito ha
    // importo negativo, un accredito positivo, quindi si somma col segno e si gira: una nota di
    // credito ABBASSA quanto risulta pagato, non lo alza.
    // CONDIVISIONE: i costi dei livelli stanno su GAMBE diverse (stesso tracking): i ledger "(ingrosso)"
    // e l'owner sono sulle gambe create dal dispatch, non sull'originante. Leggo i movimenti di TUTTE le
    // gambe, se no i livelli codice/owner risultano "pagato 0" e la differenza esce come prezzo pieno
    // invece dell'incremento. Per una spedizione normale `legs` è una riga sola → identico a prima.
    // NON OGNI "RETTIFICA" E' NOLO. Col tipo 'rettifica' passano anche i costi del fornitore per resi e
    // giacenze (RESOFORN-, GIACFORN-) coi loro storni (STORNOFORN-), e gli STORNI DEI RESI addebitati per
    // sbaglio: il 15/10/2026 un reso addebitato due volte a Wave e LOGIXIA (pacco condiviso) e' stato
    // restituito con +3,85 di tipo 'rettifica', e qui sembrava un rimborso del nolo — ricaricando il file
    // LOGIXIA del 12/10 a Wave si sarebbero richiesti 3,85 € su 13 pacchi che non erano cambiati di peso
    // (282224J031018: da 1 a 0,02 kg). Uno storno di reso si riconosce dai soldi, non dalla descrizione (che
    // un lavoro pianificato riscrive): stesso pagante, stesso riferimento, importo esattamente opposto a un
    // addebito 'reso' o 'giacenza'. Le correzioni di peso a mano (MAN-), gli allineamenti di margine e i
    // riaddebiti dopo un annullo restano: quelli sono nolo.
    const { data: movTutti } = await admin.from('movimenti')
      .select('importo,cliente_id,master_id,master_target_id,tipo,riferimento')
      .in('spedizione_id', (legs || []).map((x: any) => x.id)).in('tipo', ['spedizione', 'rettifica', 'reso', 'giacenza'])
    const paganteDi = (m: any) => m.cliente_id ? 'c:' + m.cliente_id : 'm:' + (m.master_target_id || m.master_id)
    const addebitiResi = new Map<string, number>()
    for (const m of (movTutti || []) as any[]) {
      if (m.tipo !== 'reso' && m.tipo !== 'giacenza') continue
      const k = `${paganteDi(m)}|${m.riferimento || ''}|${Math.round(-Number(m.importo || 0) * 100)}`
      addebitiResi.set(k, (addebitiResi.get(k) || 0) + 1)
    }
    const mov = ((movTutti || []) as any[]).filter((m: any) => {
      if (m.tipo === 'spedizione') return true
      if (m.tipo !== 'rettifica') return false
      const rif = String(m.riferimento || '')
      if (/^(RESOFORN|GIACFORN|STORNOFORN)-/.test(rif)) return false
      const k = `${paganteDi(m)}|${rif}|${Math.round(Number(m.importo || 0) * 100)}`
      const n = addebitiResi.get(k) || 0
      if (n > 0) { addebitiResi.set(k, n - 1); return false }
      return true
    })
    const quantoPesa = (m: any) => m.tipo === 'spedizione'
      ? Math.abs(Number(m.importo || 0))
      : -Number(m.importo || 0)
    const pagatoCliente = (mov || []).filter((m: any) => m.cliente_id)
      .reduce((a: number, m: any) => a + quantoPesa(m), 0)
    const pagatoMaster = new Map<string, number>()
    for (const m of (mov || [])) {
      // CHI PAGA E' `master_target_id`, NON `master_id`: il primo e' il master a cui il credito
      // viene scalato, il secondo e' quello che incassa. Coincidono quando l'addebito scende a
      // cascata, ma non quando un master spedisce PER CONTO di un suo sotto-master — li' il
      // movimento del figlio risulta intestato al padre, e leggendo la colonna sbagliata il padre
      // sembrerebbe aver pagato il doppio e il figlio niente. Tutto il resto del progetto legge
      // il pagante da master_target_id (lista movimenti, report).
      const chiPaga = m.master_target_id || m.master_id
      if (m.cliente_id || !chiPaga) continue
      pagatoMaster.set(chiPaga, (pagatoMaster.get(chiPaga) || 0) + quantoPesa(m))
    }

    const { data: corr } = await admin.from('corrieri')
      .select('id,nome_contratto,master_id,tipo').eq('id', s.corriere_id).maybeSingle()
    // CONDIVISIONE: pagato per-CLIENTE (non solo il totale): un pacco condiviso ha più movimenti-cliente
    // (il cliente finale + i ledger "(ingrosso)" dei livelli-codice); servono separati per il riprezzo.
    const pagatoPerCliente = new Map<string, number>()
    for (const m of (mov || [])) if (m.cliente_id) pagatoPerCliente.set(m.cliente_id, (pagatoPerCliente.get(m.cliente_id) || 0) + quantoPesa(m))

    // ── CLIENTE + MASTER: costruzione dei livelli, opzionalmente su una FASCIA UNICA (zonaForzata) ──
    // Estratta in una funzione così la si può rifare un SECONDO giro forzando 'Italia' quando le zone
    // dei livelli non coincidono (evita MULTI su SCS + Ecomize su Italia) o quando un livello, che il
    // listino coprirebbe su Italia, resta bloccato dall'esclusione zona-disagiata.
    // `pk` = i colli da prezzare: quelli ripesati, oppure quelli dichiarati per limitaAiChili.
    const costruisciLivelli = async (zonaForzata?: string, pk = packages) => {
      const livelli: LivelloRettifica[] = []
      const detentori: string[] = []
      const zone: (string | null)[] = []
      let pesoVolumeDopo: number | null = null
      let motivo: string | undefined
      let catenaDalBasso: string[] = []
      let catenaCompleta = true
      let bloccato = false   // un livello CHE HA il listino ma non prezza la zona (Italia potrebbe sbloccarlo)
      let costoDetentore: EsitoRipesatura['costoDetentore'] = null

      // ── IL CLIENTE ──
      if (s.cliente_id) {
        const { data: cl } = await admin.from('clienti')
          .select('ragione_sociale,listino_cliente_id').eq('id', s.cliente_id).maybeSingle()
        let dovuto: number | null = null
        if (cl?.listino_cliente_id) {
          const ris = await calcolaPrezzoListino(admin, {
            listinoId: cl.listino_cliente_id, corriereId: s.corriere_id, packages: pk, ...dest, zonaForzata,
          })
          if (ris) {
            zone.push(ris.zona)
            // Per il CLIENTE il volume lo dice il SUO listino (fattore suo): e' quello esatto.
            if (Number(ris.peso_volume) > 0) pesoVolumeDopo = arrotonda(Number(ris.peso_volume))
            // LE DUE CIFRE DEVONO ESSERE FATTE CON LA STESSA RICETTA.
            // `pagato` viene dai movimenti, e alla creazione il cliente e' addebitato di
            // nolo + fee contrassegno + fee assicurazione. Riprezzando il solo nolo si sottraeva una
            // mela da una pera: su una spedizione con contrassegno la fee finiva tutta dentro la
            // differenza, e una ripesatura da un euro usciva come nota di credito. Al livello dei
            // master le fee erano gia' passate (qui sotto, a costruisciCatena): l'asimmetria era
            // dentro la stessa funzione. La fee si RICALCOLA sul nolo nuovo, come fa la creazione,
            // perche' certi scaglioni sono in percentuale sul nolo.
            const sup = await calcolaSupplementiCliente(admin, {
              listinoId: cl.listino_cliente_id, corriereId: s.corriere_id,
              contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0),
              valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo,
              pesoReale: Number(s.peso_reale || 0),
            })
            // `disponibile: false` NON e' "fee zero", e' "non so quanto vale": quel listino non
            // prezza contrassegno o assicurazione per quel contratto, e la funzione lo dice cosi',
            // senza errore — alla creazione e sull'API pubblica quella stessa condizione fa
            // rispondere 400. Prendendo lo zero, il dovuto perderebbe una commissione che il cliente
            // ha gia' pagato e la rettifica uscirebbe a suo favore. Meglio nessun numero che uno
            // storto: `dovuto` resta null e la riga non viene scritta, come quando manca la tariffa.
            // (Oggi in produzione sono 19 spedizioni con contrassegno in questo stato.)
            if (sup.disponibile) {
              // I servizi accessori scelti sono dentro quello che il cliente ha pagato — alla
              // creazione si addebita il MAGGIORE fra listino e totale dichiarato, e il dichiarato li
              // comprende. Si riportano come sono stati addebitati, non si ricalcolano: l'importo li'
              // dentro e' gia' quello risolto allora, percentuali sul valore merce comprese.
              const acc = Array.isArray(s.servizi_accessori)
                ? s.servizi_accessori.reduce((a: number, x: any) => a + (Number(x?.importo) || 0), 0)
                : 0
              dovuto = arrotonda(ris.prezzo + sup.contrassegno + sup.assicurazione + acc)
            } else {
              motivo = 'il listino non prezza contrassegno/assicurazione per questo contratto'
            }
          } else {
            bloccato = true   // ha il listino ma non prezza la zona -> forse Italia lo sblocca
          }
        }
        livelli.push({
          chi: cl?.ragione_sociale || 'cliente', clienteId: s.cliente_id, masterId: null,
          pagato: arrotonda(pagatoCliente), dovuto,
          differenza: dovuto == null ? null : arrotonda(dovuto - pagatoCliente),
        })
      }

      // ── I MASTER DELLA CATENA ──
      // Stessa funzione che ha fatto l'addebito, con il collo ripesato al posto di quello dichiarato.
      if (corr) {
        const { catena, errore } = await costruisciCatena(admin, {
          masterDirettoId: s.master_id, corriereOwnerId: corr.master_id,
          costoSpedizione: 0, provincia: dest.provincia, packages: pk,
          cap: dest.cap, citta: dest.citta, paese: dest.paese,
          corriereNome: corr.nome_contratto,
          contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0),
          mittCap: s.mitt_cap || '', mittProvincia: s.mitt_provincia || '', mittPaese: 'IT',
          zonaForzata,
        })
        if (errore) { motivo = errore; bloccato = true }
        // Una catena interrotta non e' una catena: i livelli sopra il punto di rottura non ci sono.
        catenaCompleta = !errore
        catenaDalBasso = catena.map(l => l.masterId)
        for (const liv of catena) {
          zone.push(liv.zona ?? null)
          const pagato = arrotonda(pagatoMaster.get(liv.masterId) || 0)
          // Il detentore del contratto paga il costo reale del fornitore, non un listino: per lui la
          // differenza e' quella che ci ha addebitato il fornitore, che sta nel file.
          const dovuto = liv.isProprietario ? arrotonda(pagato + r.addebitoFornitore) : arrotonda(liv.prezzo)
          // Il suo costo vero dal suo listino (prezzo 0 = non ha un listino di costo per questo contratto:
          // si ripiega sul costo della spedizione, che qui e' 0, quindi il costo non si conosce).
          if (liv.isProprietario && liv.prezzo > 0) {
            costoDetentore = { masterId: liv.masterId, pagato, dovuto: arrotonda(liv.prezzo), differenza: arrotonda(liv.prezzo - pagato) }
          }
          if (liv.isProprietario) detentori.push(liv.masterId)
          livelli.push({
            chi: liv.nome, clienteId: null, masterId: liv.masterId,
            pagato, dovuto, differenza: arrotonda(dovuto - pagato),
          })
        }
      }
      return { livelli, zone, pesoVolumeDopo, motivo, catenaDalBasso, catenaCompleta, bloccato, costoDetentore, detentori }
    }

    // ── CONDIVISIONE: livelli sulla catena-FORNITORE (non l'albero), senza toccare costruisciCatena
    // (che serve ai contratti normali). Stesso prezzo della creazione, sul collo RIPESATO: albero →
    // calcolaPrezzoCorriereDettaglio del livello; codice → listino del cliente-ledger × corriere del
    // VENDITORE (come /api/v1); owner → corriere reale. differenza = dovuto(ripesato) − pagato(movimenti,
    // dal ledger per i codice). catenaDalBasso = catena-fornitore → l'upload e la propagazione trovano il
    // master che carica (prima cadeva "fuori catena" perché l'owner non è nell'albero dell'originante). ──
    const costruisciLivelliCondivisione = async (pk = packages) => {
      // La fila del contratto dai puntatori, dalla riga della gamba originante: chi carica il file del
      // fornitore (il detentore vero) ci sta dentro anche quando il ponte è comprato da una copia d'albero.
      const catena = await catenaDaCorriere(admin, s.corriere_id, { master: s.master_id, nomeContratto: corr!.nome_contratto })
      if (!catena.length) return null
      const { data: nomiM } = await admin.from('masters').select('id,nome').in('id', catena.map(l => l.master))
      const nomeM = new Map((nomiM || []).map((m: any) => [m.id, m.nome]))
      const pesoRip = pk.reduce((a, p) => a + (Number(p.weight) || 0), 0) || 1
      const livelli: LivelloRettifica[] = []
      let catenaCompleta = true
      if (s.cliente_id) {
        const { data: cl } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').eq('id', s.cliente_id).maybeSingle()
        let dovuto: number | null = null
        if ((cl as any)?.listino_cliente_id) {
          const ris = await calcolaPrezzoListino(admin, { listinoId: (cl as any).listino_cliente_id, corriereId: s.corriere_id, packages: pk, ...dest })
          if (ris) {
            const sup = await calcolaSupplementiCliente(admin, { listinoId: (cl as any).listino_cliente_id, corriereId: s.corriere_id, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo, pesoReale: Number(s.peso_reale || 0) })
            if (sup.disponibile) {
              const acc = Array.isArray(s.servizi_accessori) ? s.servizi_accessori.reduce((a: number, x: any) => a + (Number(x?.importo) || 0), 0) : 0
              dovuto = arrotonda(ris.prezzo + sup.contrassegno + sup.assicurazione + acc)
            }
          } else catenaCompleta = false
        }
        const pag = arrotonda(pagatoPerCliente.get(s.cliente_id) || 0)
        livelli.push({ chi: (cl as any)?.ragione_sociale || 'cliente', clienteId: s.cliente_id, masterId: null, pagato: pag, dovuto, differenza: dovuto == null ? null : arrotonda(dovuto - pag) })
      }
      for (const liv of catena) {
        let dovuto: number | null = null
        let pag = 0
        if (liv.ruolo === 'codice' && liv.ledgerClienteId && liv.fornitore) {
          // Livello-CODICE: prezzato col listino del cliente-ledger contro il corriere del VENDITORE;
          // pagato = quanto risulta scalato al ledger alla creazione. (L'addebito vero in conferma scala
          // il ledger — vedi rettifiche/route.ts; qui si calcola solo la differenza.)
          const { data: lc } = await admin.from('clienti').select('listino_cliente_id').eq('id', liv.ledgerClienteId).maybeSingle()
          const corrVend = liv.corriereFornitoreId || await corriereDiMasterPerNome(admin, liv.fornitore, corr!.nome_contratto)
          pag = arrotonda(pagatoPerCliente.get(liv.ledgerClienteId) || 0)
          if ((lc as any)?.listino_cliente_id && corrVend) {
            const ris = await calcolaPrezzoListino(admin, { listinoId: (lc as any).listino_cliente_id, corriereId: corrVend, packages: pk, ...dest })
            if (ris) {
              const sup = await calcolaSupplementiCliente(admin, { listinoId: (lc as any).listino_cliente_id, corriereId: corrVend, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo, pesoReale: Number(s.peso_reale || 0) })
              dovuto = sup.disponibile ? arrotonda(ris.prezzo + sup.contrassegno + sup.assicurazione) : arrotonda(ris.prezzo)
            } else catenaCompleta = false
          } else catenaCompleta = false
        } else {
          // ALBERO / OWNER: dal listino del livello per il suo corriere (reale per l'owner).
          pag = arrotonda(pagatoMaster.get(liv.master) || 0)
          const d = await calcolaPrezzoCorriereDettaglio(admin, { corriereId: liv.corriereId, masterId: liv.master, provincia: dest.provincia, cap: dest.cap, citta: dest.citta, paese: dest.paese, pesoReale: pesoRip, packages: pk, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), mittCap: dest.mittCap, mittProvincia: dest.mittProvincia, mittPaese: dest.mittPaese })
          if (d && (d as any).totale != null && isFinite((d as any).totale)) dovuto = arrotonda((d as any).totale)
          else catenaCompleta = false
        }
        // masterId = il master del livello (così l'upload/propagazione lo trova per figlio); per i codice
        // il DENARO va sul ledger ma la rettifica è indirizzata al master, e la conferma risolve il ledger.
        livelli.push({ chi: String(nomeM.get(liv.master) || liv.master), clienteId: null, masterId: liv.master, pagato: pag, dovuto, differenza: dovuto == null ? null : arrotonda(dovuto - pag),
          ruolo: liv.ruolo, fornitore: liv.fornitore, ledgerClienteId: liv.ledgerClienteId })
      }
      // Il detentore e' l'ultimo della fila: il suo livello e' gia' prezzato sul suo contratto reale.
      const top = livelli.find(l => l.masterId === catena[catena.length - 1]?.master)
      const costoDetentore: EsitoRipesatura['costoDetentore'] = top && top.dovuto != null && top.masterId
        ? { masterId: top.masterId, pagato: top.pagato, dovuto: top.dovuto, differenza: arrotonda(top.dovuto - top.pagato) } : null
      return { livelli, zone: [] as (string | null)[], pesoVolumeDopo: null as number | null, motivo: undefined as string | undefined, catenaDalBasso: catena.map(l => l.master), catenaCompleta, bloccato: false, costoDetentore, detentori: [] as string[] }
    }

    // PASSO 1: normale (ogni livello con la sua zona). PASSO 2 (solo se serve): stessa fascia 'Italia'
    // per TUTTI, così non si mescolano zone diverse tra i livelli e non restano bloccati per assenza
    // della fascia disagiata. Si usa il forzato SOLO se sblocca davvero: altrimenti resta il passo 1
    // (identico a oggi -> nessuna regressione sulle spedizioni che gia' funzionano).
    // CONDIVISIONE (corriere ponte): catena-fornitore, un passo solo (zone coerenti, stesso contratto).
    const condivisa = corr?.tipo === 'moovexpress' ? await costruisciLivelliCondivisione() : null
    let res = condivisa || await costruisciLivelli()
    let zonaUsata: string | undefined
    const zoneValide = res.zone.filter((z): z is string => !!z)
    const incoerente = new Set(zoneValide).size > 1
    if (res.bloccato || incoerente) {
      const forzato = await costruisciLivelli('Italia')
      if (!forzato.bloccato) { res = forzato; zonaUsata = 'Italia' }
    }

    // LA RETTIFICA CONTA I CHILI, NON I CAMBI DI PREZZO. `dovuto` e' il listino di OGGI sul collo
    // ripesato, `pagato` quello che si e' pagato il giorno della spedizione: se nel frattempo il listino
    // e' salito, la differenza si porta dietro l'aumento. L'1-2/11/2026 MULTI, Velox, GTS, spedizioni 2000
    // ed Ecomize hanno alzato BRT del 2-2,5%, e 050039152917364 (per il fornitore da 75 a 100 kg, nei
    // listini sempre "fino a 100") sarebbe uscito 0,42 a Ecomize e 0,46 a DELYFAST con zero chili in piu'.
    // Regola di Lorenzo (02/11): un pacco che resta nella stessa fascia non paga ne' la rettifica ne'
    // l'aumento. Quindi l'addebito non supera il SALTO fatto con lo stesso listino: oggi sul ripesato meno
    // oggi sul dichiarato. Si limita solo un addebito, mai un rimborso; se il listino e' sceso, o il
    // dichiarato non si conosce con certezza, il conto resta quello di prima.
    const deveQualcosa = res.livelli.some(l => (l.differenza ?? 0) >= 0.01) || (res.costoDetentore?.differenza ?? 0) >= 0.01
    if (deveQualcosa) {
      let rawResponse: any = null
      if (Math.max(1, Number(s.colli) || 1) > 1 && !(Array.isArray(s.colli_dettaglio) && s.colli_dettaglio.length)) {
        const { data: sr } = await admin.from('spedizioni').select('raw_response').eq('id', s.id).maybeSingle()
        rawResponse = sr?.raw_response ?? null
      }
      const dichiarati = colliDichiarati(s, rawResponse)
      const resDich = !dichiarati.length ? null
        : condivisa && res === condivisa ? await costruisciLivelliCondivisione(dichiarati)
        : await costruisciLivelli(zonaUsata, dichiarati)
      if (resDich) {
        const chiave = (l: LivelloRettifica) => `${l.clienteId || ''}|${l.masterId || ''}|${l.ledgerClienteId || ''}`
        const dovutoDich = new Map(resDich.livelli.filter(l => l.dovuto != null).map(l => [chiave(l), l.dovuto as number]))
        // Il detentore col contratto proprio non ha un listino qui: il suo dovuto e' pagato + addebito del
        // fornitore, uguale nei due giri, e il salto verrebbe zero.
        const detentori = new Set(res.detentori)
        res = {
          ...res,
          livelli: res.livelli.map(l => (l.masterId && detentori.has(l.masterId)) ? l : soloIlSalto(l, dovutoDich.get(chiave(l)))),
          costoDetentore: res.costoDetentore ? soloIlSalto(res.costoDetentore, resDich.costoDetentore?.dovuto) : res.costoDetentore,
        }
      }
    }
    base.livelli = res.livelli
    if (res.pesoVolumeDopo != null) base.pesoVolumeDopo = res.pesoVolumeDopo
    if (res.motivo) base.motivo = res.motivo
    base.catenaDalBasso = res.catenaDalBasso
    base.catenaCompleta = res.catenaCompleta
    base.costoDetentore = res.costoDetentore ?? null

    return base
  }

  let prossima = 0
  await Promise.all(Array.from({ length: Math.min(RIGHE_INSIEME, righe.length) }, async () => {
    while (prossima < righe.length) {
      const k = prossima++
      out[k] = await elabora(righe[k])
    }
  }))

  return out
}
