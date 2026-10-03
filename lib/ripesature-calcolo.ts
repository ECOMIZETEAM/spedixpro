import { calcolaPrezzoListino, calcolaSupplementiCliente, calcolaPesoFatturato, fattoreVolumeCorriere, calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'
import { costruisciCatena } from '@/lib/cascata'
import { risolviCatenaCondivisione } from '@/lib/condivisione-catena'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'
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
  // I colli come li ha rimisurati il fornitore. Viaggiano con la rettifica perche' chi la ricevera'
  // dovra' riprezzarli col PROPRIO listino per girarli al livello sotto: la cifra in euro non
  // scende lungo la catena, e col solo peso il volume — che e' quello che fa il supplemento — si
  // perderebbe per strada.
  colli_ripesati?: { weight: number; length: number; width: number; height: number }[]
}

const arrotonda = (n: number) => Math.round(n * 100) / 100

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
      .select('id,cliente_id,master_id,corriere_id,stato,peso_fatturato,peso_reale,peso_volume,dest_provincia,dest_cap,dest_citta,dest_paese,mitt_cap,mitt_provincia,contrassegno,assicurazione,valore_merce,servizi_accessori,numero,tracking_number')
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
    const { data: mov } = await admin.from('movimenti')
      .select('importo,cliente_id,master_id,master_target_id,tipo')
      .in('spedizione_id', (legs || []).map((x: any) => x.id)).in('tipo', ['spedizione', 'rettifica'])
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
    const costruisciLivelli = async (zonaForzata?: string) => {
      const livelli: LivelloRettifica[] = []
      const zone: (string | null)[] = []
      let pesoVolumeDopo: number | null = null
      let motivo: string | undefined
      let catenaDalBasso: string[] = []
      let catenaCompleta = true
      let bloccato = false   // un livello CHE HA il listino ma non prezza la zona (Italia potrebbe sbloccarlo)

      // ── IL CLIENTE ──
      if (s.cliente_id) {
        const { data: cl } = await admin.from('clienti')
          .select('ragione_sociale,listino_cliente_id').eq('id', s.cliente_id).maybeSingle()
        let dovuto: number | null = null
        if (cl?.listino_cliente_id) {
          const ris = await calcolaPrezzoListino(admin, {
            listinoId: cl.listino_cliente_id, corriereId: s.corriere_id, packages, ...dest, zonaForzata,
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
          costoSpedizione: 0, provincia: dest.provincia, packages,
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
          livelli.push({
            chi: liv.nome, clienteId: null, masterId: liv.masterId,
            pagato, dovuto, differenza: arrotonda(dovuto - pagato),
          })
        }
      }
      return { livelli, zone, pesoVolumeDopo, motivo, catenaDalBasso, catenaCompleta, bloccato }
    }

    // ── CONDIVISIONE: livelli sulla catena-FORNITORE (non l'albero), senza toccare costruisciCatena
    // (che serve ai contratti normali). Stesso prezzo della creazione, sul collo RIPESATO: albero →
    // calcolaPrezzoCorriereDettaglio del livello; codice → listino del cliente-ledger × corriere del
    // VENDITORE (come /api/v1); owner → corriere reale. differenza = dovuto(ripesato) − pagato(movimenti,
    // dal ledger per i codice). catenaDalBasso = catena-fornitore → l'upload e la propagazione trovano il
    // master che carica (prima cadeva "fuori catena" perché l'owner non è nell'albero dell'originante). ──
    const costruisciLivelliCondivisione = async () => {
      const catena = await risolviCatenaCondivisione(admin, s.master_id, corr!.nome_contratto)
      if (!catena.length) return null
      const { data: nomiM } = await admin.from('masters').select('id,nome').in('id', catena.map(l => l.master))
      const nomeM = new Map((nomiM || []).map((m: any) => [m.id, m.nome]))
      const pesoRip = packages.reduce((a, p) => a + (Number(p.weight) || 0), 0) || 1
      const livelli: LivelloRettifica[] = []
      let catenaCompleta = true
      if (s.cliente_id) {
        const { data: cl } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').eq('id', s.cliente_id).maybeSingle()
        let dovuto: number | null = null
        if ((cl as any)?.listino_cliente_id) {
          const ris = await calcolaPrezzoListino(admin, { listinoId: (cl as any).listino_cliente_id, corriereId: s.corriere_id, packages, ...dest })
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
          const corrVend = await corriereDiMasterPerNome(admin, liv.fornitore, corr!.nome_contratto)
          pag = arrotonda(pagatoPerCliente.get(liv.ledgerClienteId) || 0)
          if ((lc as any)?.listino_cliente_id && corrVend) {
            const ris = await calcolaPrezzoListino(admin, { listinoId: (lc as any).listino_cliente_id, corriereId: corrVend, packages, ...dest })
            if (ris) {
              const sup = await calcolaSupplementiCliente(admin, { listinoId: (lc as any).listino_cliente_id, corriereId: corrVend, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), valoreMerce: Number(s.valore_merce || 0), nolo: ris.prezzo, pesoReale: Number(s.peso_reale || 0) })
              dovuto = sup.disponibile ? arrotonda(ris.prezzo + sup.contrassegno + sup.assicurazione) : arrotonda(ris.prezzo)
            } else catenaCompleta = false
          } else catenaCompleta = false
        } else {
          // ALBERO / OWNER: dal listino del livello per il suo corriere (reale per l'owner).
          pag = arrotonda(pagatoMaster.get(liv.master) || 0)
          const d = await calcolaPrezzoCorriereDettaglio(admin, { corriereId: liv.corriereId, masterId: liv.master, provincia: dest.provincia, cap: dest.cap, citta: dest.citta, paese: dest.paese, pesoReale: pesoRip, packages, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0), mittCap: dest.mittCap, mittProvincia: dest.mittProvincia, mittPaese: dest.mittPaese })
          if (d && (d as any).totale != null && isFinite((d as any).totale)) dovuto = arrotonda((d as any).totale)
          else catenaCompleta = false
        }
        // masterId = il master del livello (così l'upload/propagazione lo trova per figlio); per i codice
        // il DENARO va sul ledger ma la rettifica è indirizzata al master, e la conferma risolve il ledger.
        livelli.push({ chi: String(nomeM.get(liv.master) || liv.master), clienteId: null, masterId: liv.master, pagato: pag, dovuto, differenza: dovuto == null ? null : arrotonda(dovuto - pag) })
      }
      return { livelli, zone: [] as (string | null)[], pesoVolumeDopo: null as number | null, motivo: undefined as string | undefined, catenaDalBasso: catena.map(l => l.master), catenaCompleta, bloccato: false }
    }

    // PASSO 1: normale (ogni livello con la sua zona). PASSO 2 (solo se serve): stessa fascia 'Italia'
    // per TUTTI, così non si mescolano zone diverse tra i livelli e non restano bloccati per assenza
    // della fascia disagiata. Si usa il forzato SOLO se sblocca davvero: altrimenti resta il passo 1
    // (identico a oggi -> nessuna regressione sulle spedizioni che gia' funzionano).
    // CONDIVISIONE (corriere ponte): catena-fornitore, un passo solo (zone coerenti, stesso contratto).
    let res = corr?.tipo === 'moovexpress' ? (await costruisciLivelliCondivisione() || await costruisciLivelli()) : await costruisciLivelli()
    const zoneValide = res.zone.filter((z): z is string => !!z)
    const incoerente = new Set(zoneValide).size > 1
    if (res.bloccato || incoerente) {
      const forzato = await costruisciLivelli('Italia')
      if (!forzato.bloccato) res = forzato
    }
    base.livelli = res.livelli
    if (res.pesoVolumeDopo != null) base.pesoVolumeDopo = res.pesoVolumeDopo
    if (res.motivo) base.motivo = res.motivo
    base.catenaDalBasso = res.catenaDalBasso
    base.catenaCompleta = res.catenaCompleta

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
