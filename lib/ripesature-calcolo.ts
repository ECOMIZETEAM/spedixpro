import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { costruisciCatena } from '@/lib/cascata'
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
  pesoDopo: number
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

export async function calcolaRipesature(admin: any, righe: Ripesatura[]): Promise<EsitoRipesatura[]> {
  const out: EsitoRipesatura[] = []

  for (const r of righe) {
    const base: EsitoRipesatura = {
      ldv: r.ldv, idOrdine: r.idOrdine, trovata: false, destinatario: r.destinatario,
      colli: r.colli.length,
      pesoPrima: 0,
      pesoDopo: arrotonda(r.colli.reduce((s, c) => s + c.peso, 0)),
      misure: r.colli.map(c => `${c.lunghezza}x${c.larghezza}x${c.altezza}`).join(' + '),
      addebitoFornitore: r.addebitoFornitore,
      livelli: [],
    }

    const { data: s } = await admin.from('spedizioni')
      .select('id,cliente_id,master_id,corriere_id,stato,peso_fatturato,dest_provincia,dest_cap,dest_citta,dest_paese,contrassegno,assicurazione,valore_merce,servizi_accessori')
      .eq('tracking_number', r.ldv).maybeSingle()
    if (!s) { out.push({ ...base, motivo: 'spedizione non trovata' }); continue }
    if (s.stato === 'annullata') { out.push({ ...base, spedizioneId: s.id, motivo: 'spedizione annullata' }); continue }

    base.trovata = true
    base.spedizioneId = s.id
    base.pesoPrima = Number(s.peso_fatturato || 0)

    // Il collo come lo ha misurato il fornitore, nella forma che vuole il motore dei prezzi.
    const packages = r.colli.map(c => ({
      weight: c.peso, length: c.lunghezza, width: c.larghezza, height: c.altezza,
    }))
    base.colli_ripesati = packages
    const dest = {
      provincia: s.dest_provincia || '', cap: s.dest_cap || '',
      citta: s.dest_citta || '', paese: s.dest_paese || 'IT',
    }

    // Quanto risulta addebitato: dai MOVIMENTI, che sono l'unico posto dove c'e' scritto davvero.
    //
    // ANCHE LE RETTIFICHE GIA' FATTE CONTANO. Se questa spedizione e' gia' stata riprezzata una
    // volta — col file dei pesi o a mano — quell'addebito e' soldi che il cliente ha gia' pagato:
    // ignorarlo vorrebbe dire chiedergli una seconda volta la stessa differenza. Un addebito ha
    // importo negativo, un accredito positivo, quindi si somma col segno e si gira: una nota di
    // credito ABBASSA quanto risulta pagato, non lo alza.
    const { data: mov } = await admin.from('movimenti')
      .select('importo,cliente_id,master_id,master_target_id,tipo')
      .eq('spedizione_id', s.id).in('tipo', ['spedizione', 'rettifica'])
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
      .select('id,nome_contratto,master_id').eq('id', s.corriere_id).maybeSingle()

    // ── IL CLIENTE ──
    if (s.cliente_id) {
      const { data: cl } = await admin.from('clienti')
        .select('ragione_sociale,listino_cliente_id').eq('id', s.cliente_id).maybeSingle()
      let dovuto: number | null = null
      if (cl?.listino_cliente_id) {
        const ris = await calcolaPrezzoListino(admin, {
          listinoId: cl.listino_cliente_id, corriereId: s.corriere_id, packages, ...dest,
        })
        if (ris) {
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
            base.motivo = 'il listino non prezza contrassegno/assicurazione per questo contratto'
          }
        }
      }
      base.livelli.push({
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
      })
      if (errore) base.motivo = errore
      // Una catena interrotta non e' una catena: i livelli sopra il punto di rottura non ci sono.
      // Chi carica, non trovandosi dentro, sembrerebbe "il primo della fila" e la rettifica gli
      // cadrebbe addosso al cliente finale saltando i master in mezzo. Meglio non scriverla.
      base.catenaCompleta = !errore
      // L'ordine della catena e' dal master della spedizione IN SU, fino al detentore. Serve per
      // sapere chi e' il figlio DIRETTO di chi carica: e' a lui che va indirizzata la rettifica.
      base.catenaDalBasso = catena.map(l => l.masterId)
      for (const liv of catena) {
        const pagato = arrotonda(pagatoMaster.get(liv.masterId) || 0)
        // Il detentore del contratto paga il costo reale del fornitore, non un listino: per lui la
        // differenza e' quella che ci ha addebitato il fornitore, che sta nel file.
        const dovuto = liv.isProprietario ? arrotonda(pagato + r.addebitoFornitore) : arrotonda(liv.prezzo)
        base.livelli.push({
          chi: liv.nome, clienteId: null, masterId: liv.masterId,
          pagato, dovuto, differenza: arrotonda(dovuto - pagato),
        })
      }
    }

    out.push(base)
  }

  return out
}
