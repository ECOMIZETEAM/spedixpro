import { calcolaPrezzoListino, calcolaSupplementiCliente, calcolaPesoFatturato, fattoreVolumeCorriere, calcolaPrezzoCorriereDettaglio, zonaDaProvincia } from '@/lib/pricing'
import { fontiCliente, archivioCostoPerPacco, type FonteCliente } from '@/lib/prezzi-archivio'
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
  zona?: string | null         // la zona del listino con cui e' stato fatto il conto: si scrive sulla riga, per dire perche'
  // SOLO sui contratti condivisi: com'e' fatto il salto di questo master verso chi gli vende. Chi
  // scrive il movimento DEVE leggerlo: su un salto 'codice' i soldi stanno sul ledger presso il
  // fornitore, non sul conto verso il padre. La correzione peso/misure li indovinava dall'albero e il
  // 13/10 ha messo due rettifiche di 282343J006009 sui conti sbagliati (Wave e MULTIEXPRESS).
  ruolo?: 'albero' | 'codice' | 'owner'
  fornitore?: string | null
  ledgerClienteId?: string | null
  // I CHILI DI VOLUME DI CHI PAGA, col divisore del SUO listino: quelli con cui e' stato prezzato questo
  // livello, ripesato e dichiarato. Sulla stessa spedizione non sono gli stessi per tutti: 282343J028496
  // (SDA EXPRESS L, 64,5x62,5x37,5) fa 25,2 kg al contratto a 6000 e 30,23 kg al cliente di Ecomize a
  // 5000, che ha pagato la fascia 50 — ma la sua riga mostrava 19,2 → 25,2, il dichiarato a 5000 dalla
  // scheda accanto al ripesato a 6000 del contratto, e la scheda e' rimasta a 25,2 kg con 16,20 €.
  // undefined = non noto (nessun listino, o dichiarato non riprezzato): si ripiega sull'esito.
  // Il divisore viaggia con la riga perche' la Conferma scriva i chili di chi paga anche sulle righe dei
  // master: in fondo a una catena SDA EXPRESS L QUICK paga a 5000, MULTI e Wave sopra di lei a 6000.
  pesoVolumeDopo?: number | null
  pesoVolumePrima?: number | null
  fattoreVolume?: number | null
  // PER DIRE PERCHE', NON PER I SOLDI. Il listino di questo livello sul collo ripesato prima del limite «la rettifica
  // conta i chili» (soloIlSalto lo riporta a pagato + salto, e su un pacco gia' rettificato sembrerebbe il prezzo di
  // listino), sul dichiarato, e i chili su cui paga (reale o volume col suo divisore, agevolazione compresa). Li scrive
  // il «Carica» sulla riga che non scende perche' sotto si paga uguale (lib/rettifiche-perche, descriviNonGirata).
  // undefined = non noto: il giro sul dichiarato si fa solo quando qualcuno deve qualcosa.
  dovutoListino?: number | null
  dovutoDichiarato?: number | null
  pesoFatturato?: number | null
  pesoFatturatoPrima?: number | null
}

// I volumi e il divisore da scrivere sulla riga di rettifica di CHI PAGA (il livello `liv`).
export function volumiDelLivello(esito: EsitoRipesatura, liv: LivelloRettifica | null | undefined) {
  return {
    peso_volume_iniziale: liv?.pesoVolumePrima ?? esito.pesoVolumePrima,
    peso_volume_reale: liv?.pesoVolumeDopo ?? (esito.pesoVolumeDopo || 0),
    fattore_volume: liv?.fattoreVolume ?? null,
  }
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

// ── QUANTO HA PAGATO OGNI LIVELLO PER IL VIAGGIO DI UN PACCO ──
// Una regola sola, usata dal motore e da chi mostra al master quanto ha incassato e speso su un pacco
// (Rettifica Costi → «non girate sotto»): se i due contassero in modo diverso, la pagina direbbe un margine
// e la rettifica ne userebbe un altro.
export const CAMPI_MOVIMENTI_NOLO = 'importo,cliente_id,master_id,master_target_id,tipo,riferimento'
export const TIPI_MOVIMENTI_NOLO = ['spedizione', 'rettifica', 'reso', 'giacenza']
// Un addebito ha importo negativo, un accredito positivo: la spedizione conta per il suo valore assoluto, la
// rettifica col segno girato, cosi' una nota di credito ABBASSA quanto risulta pagato.
export const quantoPesaNolo = (m: any) => m.tipo === 'spedizione'
  ? Math.abs(Number(m.importo || 0))
  : -Number(m.importo || 0)
// NON OGNI "RETTIFICA" E' NOLO. Col tipo 'rettifica' passano anche i costi del fornitore per resi e
// giacenze (RESOFORN-, GIACFORN-) coi loro storni (STORNOFORN-), e gli STORNI DEI RESI addebitati per
// sbaglio: il 15/10/2026 un reso addebitato due volte a Wave e LOGIXIA (pacco condiviso) e' stato
// restituito con +3,85 di tipo 'rettifica', e qui sembrava un rimborso del nolo — ricaricando il file
// LOGIXIA del 12/10 a Wave si sarebbero richiesti 3,85 € su 13 pacchi che non erano cambiati di peso
// (282224J031018: da 1 a 0,02 kg). Uno storno di reso si riconosce dai soldi, non dalla descrizione (che
// un lavoro pianificato riscrive): stesso pagante, stesso riferimento, importo esattamente opposto a un
// addebito 'reso' o 'giacenza'. Le correzioni di peso a mano (MAN-), gli allineamenti di margine e i
// riaddebiti dopo un annullo restano: quelli sono nolo. Fuori anche la POD (riferimento POD-, dal
// 04/11/2026, scripts/pod-addebito.sql): e' la prova di consegna, non il viaggio, e contata qui
// abbasserebbe la rettifica dopo di quanto il cliente o il master ha pagato la POD.
// `movTutti` = i movimenti di TUTTE le gambe di un pacco, dei tipi TIPI_MOVIMENTI_NOLO.
export function movimentiDelNolo(movTutti: any[]): any[] {
  const paganteDi = (m: any) => m.cliente_id ? 'c:' + m.cliente_id : 'm:' + (m.master_target_id || m.master_id)
  const addebitiResi = new Map<string, number>()
  for (const m of movTutti) {
    if (m.tipo !== 'reso' && m.tipo !== 'giacenza') continue
    const k = `${paganteDi(m)}|${m.riferimento || ''}|${Math.round(-Number(m.importo || 0) * 100)}`
    addebitiResi.set(k, (addebitiResi.get(k) || 0) + 1)
  }
  return movTutti.filter((m: any) => {
    if (m.tipo === 'spedizione') return true
    if (m.tipo !== 'rettifica') return false
    const rif = String(m.riferimento || '')
    if (/^(RESOFORN|GIACFORN|STORNOFORN|POD)-/.test(rif)) return false
    const k = `${paganteDi(m)}|${rif}|${Math.round(Number(m.importo || 0) * 100)}`
    const n = addebitiResi.get(k) || 0
    if (n > 0) { addebitiResi.set(k, n - 1); return false }
    return true
  })
}

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

  // CHI PAGA ANCHE GLI AUMENTI (masters.impostazioni.rettifica_paga_aumenti). Per lui la rettifica non si ferma al salto
  // di fascia: paga il listino di oggi sul ripesato meno quello che ha pagato, aumenti compresi. Deciso da Lorenzo il
  // 18/11/2026 per Ecomize Solution, che compra a costo + 0,10: quando il fornitore rifà il pacco vecchio coi prezzi
  // nuovi (BRT +2% e carburante dal 02/11), con la regola «solo chili» la differenza restava a MULTI su ogni pacco
  // (112 righe rosse in Rettifica Costi, in media 0,12 € l'una). Per tutti gli altri la regola del 02/11 resta.
  const pagaAumenti = new Map<string, boolean>()
  const leggiPagaAumenti = async (ids: string[]) => {
    const mancano = [...new Set(ids)].filter(id => id && !pagaAumenti.has(id))
    if (!mancano.length) return
    const { data } = await admin.from('masters').select('id,impostazioni').in('id', mancano)
    for (const id of mancano) pagaAumenti.set(id, false)
    for (const m of (data || []) as any[]) pagaAumenti.set(m.id, m.impostazioni?.rettifica_paga_aumenti === true)
  }

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
      .select('id,cliente_id,master_id,corriere_id,listino_cliente_id,stato,created_at,peso_fatturato,peso_reale,peso_volume,lunghezza,larghezza,altezza,colli,colli_dettaglio,dest_provincia,dest_cap,dest_citta,dest_paese,mitt_cap,mitt_provincia,contrassegno,assicurazione,valore_merce,servizi_accessori,numero,tracking_number')
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

    // Il collo come lo ha misurato il fornitore, nella forma che vuole il motore dei prezzi. Il peso reale del
    // fornitore (solo se ha scritto i pesi senza misure) segue il collo: lo usa la sponda (lib/pricing pesoRealeSponda).
    const packages = r.colli.map(c => ({
      weight: c.peso, length: c.lunghezza, width: c.larghezza, height: c.altezza,
      ...(Number(c.pesoReale) > 0 ? { pesoRealeFornitore: Number(c.pesoReale) } : {}),
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
    // Quali movimenti sono nolo e quanto pesano: movimentiDelNolo / quantoPesaNolo, qui sotto.
    const { data: movTutti } = await admin.from('movimenti')
      .select(CAMPI_MOVIMENTI_NOLO)
      .in('spedizione_id', (legs || []).map((x: any) => x.id)).in('tipo', TIPI_MOVIMENTI_NOLO)
    const mov = movimentiDelNolo((movTutti || []) as any[])
    const quantoPesa = quantoPesaNolo
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
        let volumeCliente: number | null = null
        let fattoreCliente: number | null = null
        let zonaCliente: string | null = null
        let fatturatoCliente: number | null = null
        // Dopo la partenza si paga sempre: le fonti del prezzo, e il loro ordine, le decide
        // lib/prezzi-archivio.ts (fontiCliente). La prima che prezza il collo ripesato e' la fonte della
        // rettifica: contrassegno e assicurazione si ricalcolano sulla stessa. Prima, a contratto tolto, la
        // rettifica del cliente non si scriveva e la differenza restava al master.
        const fontiCli = await fontiCliente(admin, s, cl?.listino_cliente_id)
        if (cl?.listino_cliente_id || fontiCli.length) {
          let ris: Awaited<ReturnType<typeof calcolaPrezzoListino>> = null
          let fonteRett: FonteCliente | null = null
          for (const f of fontiCli) {
            ris = await calcolaPrezzoListino(admin, {
              listinoId: f.listinoId, corriereId: s.corriere_id, packages: pk, ...dest, zonaForzata, archivio: f.archivio,
            })
            if (ris) { fonteRett = f; break }
          }
          if (ris) {
            zone.push(ris.zona)
            zonaCliente = ris.zona ?? null
            // Per il CLIENTE il volume lo dice il SUO listino (fattore suo): e' quello esatto.
            if (Number(ris.peso_volume) > 0) pesoVolumeDopo = arrotonda(Number(ris.peso_volume))
            volumeCliente = arrotonda(Number(ris.peso_volume) || 0)
            fattoreCliente = Number(ris.fattore_volume) || null
            fatturatoCliente = Number(ris.peso_fatturato) > 0 ? arrotonda(Number(ris.peso_fatturato)) : null
            // LE DUE CIFRE DEVONO ESSERE FATTE CON LA STESSA RICETTA.
            // `pagato` viene dai movimenti, e alla creazione il cliente e' addebitato di
            // nolo + fee contrassegno + fee assicurazione. Riprezzando il solo nolo si sottraeva una
            // mela da una pera: su una spedizione con contrassegno la fee finiva tutta dentro la
            // differenza, e una ripesatura da un euro usciva come nota di credito. Al livello dei
            // master le fee erano gia' passate (qui sotto, a costruisciCatena): l'asimmetria era
            // dentro la stessa funzione. La fee si RICALCOLA sul nolo nuovo, come fa la creazione,
            // perche' certi scaglioni sono in percentuale sul nolo.
            const sup = await calcolaSupplementiCliente(admin, {
              listinoId: fonteRett!.listinoId, corriereId: s.corriere_id,
              contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0),
              valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo,
              pesoReale: Number(s.peso_reale || 0), archivio: fonteRett!.archivio,
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
          zona: zonaCliente,
          pagato: arrotonda(pagatoCliente), dovuto,
          differenza: dovuto == null ? null : arrotonda(dovuto - pagatoCliente),
          pesoVolumeDopo: volumeCliente, fattoreVolume: fattoreCliente, pesoFatturato: fatturatoCliente,
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
          // Il pacco e' partito: un livello a cui hanno cancellato i prezzi di costo DOPO la partenza paga
          // quelli archiviati (lib/prezzi-archivio.ts, archivioCostoPerPacco).
          partenza: s.created_at || null,
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
            chi: liv.nome, clienteId: null, masterId: liv.masterId, zona: liv.zona ?? null,
            pagato, dovuto, differenza: arrotonda(dovuto - pagato),
            pesoVolumeDopo: liv.pesoVolume != null ? arrotonda(Number(liv.pesoVolume) || 0) : null,
            fattoreVolume: Number(liv.fattoreVolume) || null,
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
        let volumeCliente: number | null = null
        let fattoreCliente: number | null = null
        let fatturatoCliente: number | null = null
        // Dopo la partenza si paga sempre: stesse fonti del ramo d'albero (sopra).
        const fontiCli = await fontiCliente(admin, s, (cl as any)?.listino_cliente_id)
        if ((cl as any)?.listino_cliente_id || fontiCli.length) {
          let ris: Awaited<ReturnType<typeof calcolaPrezzoListino>> = null
          let fonteRett: FonteCliente | null = null
          for (const f of fontiCli) {
            ris = await calcolaPrezzoListino(admin, { listinoId: f.listinoId, corriereId: s.corriere_id, packages: pk, ...dest, archivio: f.archivio })
            if (ris) { fonteRett = f; break }
          }
          if (ris) {
            volumeCliente = arrotonda(Number(ris.peso_volume) || 0)
            fattoreCliente = Number(ris.fattore_volume) || null
            fatturatoCliente = Number(ris.peso_fatturato) > 0 ? arrotonda(Number(ris.peso_fatturato)) : null
            const sup = await calcolaSupplementiCliente(admin, { listinoId: fonteRett!.listinoId, corriereId: s.corriere_id, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo, pesoReale: Number(s.peso_reale || 0), archivio: fonteRett!.archivio })
            if (sup.disponibile) {
              const acc = Array.isArray(s.servizi_accessori) ? s.servizi_accessori.reduce((a: number, x: any) => a + (Number(x?.importo) || 0), 0) : 0
              dovuto = arrotonda(ris.prezzo + sup.contrassegno + sup.assicurazione + acc)
            }
          } else catenaCompleta = false
        }
        const pag = arrotonda(pagatoPerCliente.get(s.cliente_id) || 0)
        livelli.push({ chi: (cl as any)?.ragione_sociale || 'cliente', clienteId: s.cliente_id, masterId: null, pagato: pag, dovuto, differenza: dovuto == null ? null : arrotonda(dovuto - pag), pesoVolumeDopo: volumeCliente, fattoreVolume: fattoreCliente, pesoFatturato: fatturatoCliente })
      }
      for (const liv of catena) {
        let dovuto: number | null = null
        let volume: number | null = null
        let fattore: number | null = null
        let pag = 0
        if (liv.ruolo === 'codice' && liv.ledgerClienteId && liv.fornitore) {
          // Livello-CODICE: prezzato col listino del cliente-ledger contro il corriere del VENDITORE;
          // pagato = quanto risulta scalato al ledger alla creazione. (L'addebito vero in conferma scala
          // il ledger — vedi rettifiche/route.ts; qui si calcola solo la differenza.)
          const { data: lc } = await admin.from('clienti').select('listino_cliente_id').eq('id', liv.ledgerClienteId).maybeSingle()
          const corrVend = liv.corriereFornitoreId || await corriereDiMasterPerNome(admin, liv.fornitore, corr!.nome_contratto)
          pag = arrotonda(pagatoPerCliente.get(liv.ledgerClienteId) || 0)
          if ((lc as any)?.listino_cliente_id && corrVend) {
            // Il ledger e' un cliente del venditore: a contratto tolto dal suo listino, prezzi archiviati.
            // Le fonti sono quelle del suo listino di oggi (il listino di partenza segnato sul pacco e' del
            // cliente finale, non suo).
            let ris: Awaited<ReturnType<typeof calcolaPrezzoListino>> = null
            let fonteL: FonteCliente | null = null
            for (const f of await fontiCliente(admin, { ...s, corriere_id: corrVend, listino_cliente_id: null }, (lc as any).listino_cliente_id)) {
              ris = await calcolaPrezzoListino(admin, { listinoId: f.listinoId, corriereId: corrVend, packages: pk, ...dest, archivio: f.archivio })
              if (ris) { fonteL = f; break }
            }
            if (ris) {
              volume = arrotonda(Number(ris.peso_volume) || 0)
              fattore = Number(ris.fattore_volume) || null
              const sup = await calcolaSupplementiCliente(admin, { listinoId: fonteL!.listinoId, corriereId: corrVend, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo, pesoReale: Number(s.peso_reale || 0), archivio: fonteL!.archivio })
              dovuto = sup.disponibile ? arrotonda(ris.prezzo + sup.contrassegno + sup.assicurazione) : arrotonda(ris.prezzo)
            } else catenaCompleta = false
          } else catenaCompleta = false
        } else {
          // ALBERO / OWNER: dal listino del livello per il suo corriere (reale per l'owner).
          pag = arrotonda(pagatoMaster.get(liv.master) || 0)
          const d = await calcolaPrezzoCorriereDettaglio(admin, { corriereId: liv.corriereId, masterId: liv.master, provincia: dest.provincia, cap: dest.cap, citta: dest.citta, paese: dest.paese, pesoReale: pesoRip, packages: pk, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), mittCap: dest.mittCap, mittProvincia: dest.mittProvincia, mittPaese: dest.mittPaese, archivio: await archivioCostoPerPacco(admin, liv.master, liv.corriereId, s.created_at || null) })
          if (d && (d as any).totale != null && isFinite((d as any).totale)) {
            dovuto = arrotonda((d as any).totale)
            volume = arrotonda(Number((d as any).peso_volume) || 0)
            fattore = Number((d as any).fattore_volume) || null
          } else catenaCompleta = false
        }
        // masterId = il master del livello (così l'upload/propagazione lo trova per figlio); per i codice
        // il DENARO va sul ledger ma la rettifica è indirizzata al master, e la conferma risolve il ledger.
        livelli.push({ chi: String(nomeM.get(liv.master) || liv.master), clienteId: null, masterId: liv.master, pagato: pag, dovuto, differenza: dovuto == null ? null : arrotonda(dovuto - pag),
          ruolo: liv.ruolo, fornitore: liv.fornitore, ledgerClienteId: liv.ledgerClienteId, pesoVolumeDopo: volume, fattoreVolume: fattore })
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
    // Il collo come era stato dichiarato (colliDichiarati), letto una volta sola: serve alla scelta della zona e al
    // conto «solo chili».
    let dichiaratiCache: any[] | null = null
    const colliDichiaratiDi = async () => {
      if (dichiaratiCache) return dichiaratiCache
      let rawResponse: any = null
      if (Math.max(1, Number(s.colli) || 1) > 1 && !(Array.isArray(s.colli_dettaglio) && s.colli_dettaglio.length)) {
        const { data: sr } = await admin.from('spedizioni').select('raw_response').eq('id', s.id).maybeSingle()
        rawResponse = sr?.raw_response ?? null
      }
      dichiaratiCache = colliDichiarati(s, rawResponse)
      return dichiaratiCache
    }
    let zonaUsata: string | undefined
    // I livelli che tengono la LORO zona anche quando il conto passa alla zona unica (vedi sotto, «ogni livello tiene la
    // sua zona»): per loro anche il dichiarato si rifà sulla loro zona, se no il salto metterebbe insieme due zone.
    const tieneSuaZona = new Set<string>()
    const chiaveLiv = (l: LivelloRettifica) => `${l.clienteId || ''}|${l.masterId || ''}|${l.ledgerClienteId || ''}`
    let detentoreSuaZona = false
    const zoneValide = res.zone.filter((z): z is string => !!z)
    const incoerente = new Set(zoneValide).size > 1
    // LA ZONA UNICA E' PRIMA QUELLA DEL PACCO, POI «ITALIA». 1ZF4328R6814924086 (UPS Italia, Curinga CZ, 02/09/2026):
    // GENIUS DELIVERY aveva pagato 12,60 €, il suo listino «Calabria fino a 5 kg». Ripesato a 9,5 kg, il listino del
    // cliente oggi non trova piu' Curinga e il conto si rifaceva tutto su «Italia»: 10,50 € contro i 12,60 gia' pagati,
    // «non c'e' niente da chiedere», e MULTI si teneva i 2,54 € del fornitore. Sulla Calabria sono 14,18: 1,58 € da
    // chiedere. Rifatte le 335 righe in attesa di MULTI verso Calabria, Sicilia e Sardegna: cambia solo questa.
    if (res.bloccato || incoerente) {
      const regionale = zonaDaProvincia(dest.provincia)
      let forzato: Awaited<ReturnType<typeof costruisciLivelli>> | null = null
      if (regionale !== 'Italia' && String(dest.paese || 'IT').toUpperCase().trim() === 'IT') {
        const f = await costruisciLivelli(regionale)
        if (!f.bloccato) { forzato = f; zonaUsata = regionale }
      }
      if (!forzato) {
        const f = await costruisciLivelli('Italia')
        if (!f.bloccato) { forzato = f; zonaUsata = 'Italia' }
      }
      if (forzato) {
        // OGNI LIVELLO SI RIFA' SULLA ZONA CON CUI HA PAGATO LA PARTENZA. La zona unica serve a chi nella sua non trova
        // un prezzo; ma chi lo trova puo' aver pagato la partenza proprio su quella zona, e rifargli il conto altrove
        // lo sfalsa. Quale delle due e' quella della partenza lo dice il collo DICHIARATO: la zona in cui il suo
        // prezzo e' piu' vicino a quanto il livello ha pagato. Casi veri (prova sulle 526 righe in attesa di MULTI, 18/11):
        // - 050148152972343 (BRT Express, 19/10): Ecomize aveva pagato 18,43 €, il prezzo Zone Disagiate (oggi 18,80);
        //   sulla zona unica (Sicilia) il dichiarato vale 10,39 e la rettifica usciva 0, coi 5,33 € del fornitore a MULTI.
        //   Sulla sua zona sono 5,48 €.
        // - 050227152946957: Ecomize aveva pagato a prezzo Italia; la sua zona di oggi (Venezia/Laguna) avrebbe chiesto
        //   48,68 € su 13,22 di fornitore. Resta sulla zona unica: 13,37.
        // - 1ZF4328R6814924086 (Curinga): GENIUS aveva pagato la Calabria, oggi il suo listino lo mette nelle Zone
        //   Disagiate Remote. Resta sulla Calabria: 1,58 € (vedi sopra).
        // A pari distanza vince la zona unica, come prima.
        const naturali = new Map(res.livelli.filter(l => l.dovuto != null).map(l => [chiaveLiv(l), l]))
        const detNat = res.costoDetentore
        const dichiaratiZ = naturali.size ? await colliDichiaratiDi() : []
        const dichNat = dichiaratiZ.length ? await costruisciLivelli(undefined, dichiaratiZ) : null
        const dichForz = dichiaratiZ.length ? await costruisciLivelli(zonaUsata, dichiaratiZ) : null
        const dovutoIn = (r0: typeof res | null, l: LivelloRettifica) => r0?.livelli.find(x => chiaveLiv(x) === chiaveLiv(l))?.dovuto ?? null
        res = {
          ...forzato,
          livelli: forzato.livelli.map(lf => {
            const ln = naturali.get(chiaveLiv(lf))
            if (!ln) return lf
            const pn = dovutoIn(dichNat, lf), pf = dovutoIn(dichForz, lf)
            const suaZona = pn != null && (pf == null || Math.abs(pn - lf.pagato) < Math.abs(pf - lf.pagato) - 0.005)
            if (!suaZona) return lf
            tieneSuaZona.add(chiaveLiv(lf))
            if (detNat && ln.masterId === detNat.masterId) detentoreSuaZona = true
            return ln
          }),
          costoDetentore: detentoreSuaZona ? detNat : forzato.costoDetentore,
        }
      }
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
      const dichiarati = await colliDichiaratiDi()
      const resDich = !dichiarati.length ? null
        : condivisa && res === condivisa ? await costruisciLivelliCondivisione(dichiarati)
        : await costruisciLivelli(zonaUsata, dichiarati)
      // il dichiarato sulla loro zona per i livelli che l'hanno tenuta (vedi «ogni livello tiene la sua zona»)
      const resDichSua = resDich && zonaUsata && tieneSuaZona.size ? await costruisciLivelli(undefined, dichiarati) : null
      if (resDich) {
        const chiave = chiaveLiv
        const daDich = (l: LivelloRettifica) => (resDichSua && tieneSuaZona.has(chiave(l)) ? resDichSua : resDich).livelli
        const dovutoDich = new Map([...resDich.livelli, ...(resDichSua?.livelli || [])].filter(l => l.dovuto != null)
          .filter(l => daDich(l).includes(l)).map(l => [chiave(l), l.dovuto as number]))
        // Il volume del dichiarato, livello per livello col suo divisore: il giro sul dichiarato lo ha gia'.
        const volumeDich = new Map([...resDich.livelli, ...(resDichSua?.livelli || [])].filter(l => l.pesoVolumeDopo != null)
          .filter(l => daDich(l).includes(l)).map(l => [chiave(l), l.pesoVolumeDopo as number]))
        const conDichiarato = (l: LivelloRettifica): LivelloRettifica =>
          volumeDich.has(chiave(l)) ? { ...l, pesoVolumePrima: volumeDich.get(chiave(l)) } : l
        // Solo per la frase (vedi dovutoListino nel tipo): i soldi restano quelli di soloIlSalto.
        const fatturatoDich = new Map([...resDich.livelli, ...(resDichSua?.livelli || [])].filter(l => l.pesoFatturato != null)
          .filter(l => daDich(l).includes(l)).map(l => [chiave(l), l.pesoFatturato as number]))
        const perDirePerche = (prima: LivelloRettifica, dopo: LivelloRettifica): LivelloRettifica => ({
          ...dopo, dovutoListino: prima.dovuto, dovutoDichiarato: dovutoDich.get(chiave(prima)) ?? null,
          ...(fatturatoDich.has(chiave(prima)) ? { pesoFatturatoPrima: fatturatoDich.get(chiave(prima)) } : {}),
        })
        // Il detentore col contratto proprio non ha un listino qui: il suo dovuto e' pagato + addebito del
        // fornitore, uguale nei due giri, e il salto verrebbe zero.
        const detentori = new Set(res.detentori)
        await leggiPagaAumenti(res.livelli.map(l => l.masterId).filter(Boolean) as string[])
        // chi paga gli aumenti li paga solo quando il pacco cambia fascia: il fornitore rifà il prezzo del pacco quando lo
        // ripesa, non quando addebita un supplemento a peso invariato (050220152957691, 151,4 kg prima e dopo: SpediamoPro
        // ha preso solo gli 11,46 € di super gdo, e la regola senza questa condizione chiedeva anche 0,84 € di «aumento»)
        const conSalto = (l: LivelloRettifica) => {
          const dich = dovutoDich.get(chiave(l))
          return l.dovuto != null && dich != null && l.dovuto - dich >= 0.01
        }
        const senzaSalto = (l: LivelloRettifica) => (l.masterId && detentori.has(l.masterId)) || (l.masterId && pagaAumenti.get(l.masterId) && conSalto(l))
        res = {
          ...res,
          livelli: res.livelli.map(l => perDirePerche(l, conDichiarato(senzaSalto(l) ? l : soloIlSalto(l, dovutoDich.get(chiave(l)))))),
          costoDetentore: res.costoDetentore ? soloIlSalto(res.costoDetentore, ((detentoreSuaZona && resDichSua) ? resDichSua : resDich).costoDetentore?.dovuto) : res.costoDetentore,
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
