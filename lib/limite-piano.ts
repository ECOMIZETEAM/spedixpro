import { meseCorrente } from '@/lib/piani'

// LIMITE DEL PIANO — lettura dello stato e regola del blocco.
//
// Ogni master vede nel proprio piano il traffico di TUTTA la sua rete: le spedizioni dei suoi
// sotto-master e dei loro clienti sono spedizioni che lui rivende, e consumano il suo pacchetto.
//
// Il blocco del LIMITE scende e non sale mai. Se un master sfonda il suo limite si fermano lui, i
// suoi sotto-master e i loro clienti — finche' non fa l'upgrade. Chi sta SOPRA non si ferma: ha il
// suo piano, lo paga, e non deve subire il mancato upgrade di qualcun altro. Per questo il
// controllo guarda la catena dal master della spedizione IN SU.
//
// Il CONGELAMENTO per canone non pagato funziona in modo diverso, ed e' voluto: riguarda SOLO chi
// non ha pagato. I suoi clienti e i suoi sotto-master continuano a spedire come sempre, i conteggi
// e i movimenti proseguono, il flusso non si ferma. A fermarsi e' lui: non vede le pagine e non
// puo' fare operazioni finche' non salda. E' una questione fra noi e lui, e non ha senso farla
// pagare a chi ha pagato.
//
// Il conteggio non si fa contando le spedizioni: c'e' un contatore per (master, mese) tenuto da un
// trigger sul database (scripts/limite-piano.sql). Contare a ogni creazione le spedizioni del mese
// dell'intero sotto-albero non regge il volume a cui puntiamo.

export type StatoPiano = {
  usato: number          // spedizioni del mese: mie + di tutta la mia rete
  limite: number         // 0 = nessun limite (il master principale, o chi non ha ancora un piano)
  perc: number           // 0-999
  avviso: boolean        // dal 90% in su
  bloccato: boolean      // resta false: le spedizioni non si fermano mai (vedi sotto)
  bloccatoDaMe: boolean  // il motivo del blocco e' MIO (quindi lo posso risolvere io)
  congelato: boolean     // IO non ho pagato il canone: non vedo e non opero, ma la mia rete lavora
  oltreIlMio: boolean    // IO ho finito il pacchetto: stesso trattamento, si riapre con l'upgrade
  motivo: 'limite' | 'pagamento' | null
  giorniPerPagare: number | null   // giorni che restano prima del congelamento (solo per me)
  // L'ISTANTE ESATTO in cui scatta, non il numero di giorni arrotondato. Un "hai 2 giorni" letto
  // di sera vuol dire una cosa diversa da un "hai 2 giorni" letto di mattina: con la scadenza vera
  // il portale puo' mostrare il tempo che resta davvero, che scende mentre lo si guarda.
  scadenzaPagamento: string | null
}

export const NESSUN_LIMITE: StatoPiano = {
  usato: 0, limite: 0, perc: 0, avviso: false, bloccato: false, bloccatoDaMe: false,
  congelato: false, oltreIlMio: false, motivo: null, giorniPerPagare: null, scadenzaPagamento: null,
}

// Giorni di tolleranza fra il canone non riuscito e il congelamento. Una carta scaduta o una banca
// che chiede conferma capitano: fermare una rete al primo tentativo fallito sarebbe sproporzionato.
export const GIORNI_TOLLERANZA = 3

// `admin` deve essere un client con service_role: il contatore e la funzione non sono leggibili
// dagli utenti (il nome del master che blocca non deve mai arrivare a chi sta sotto).
export async function statoPiano(admin: any, masterId: string | null | undefined): Promise<StatoPiano> {
  if (!masterId) return NESSUN_LIMITE
  const { data, error } = await admin.rpc('fn_limiti_catena', { p_master: masterId, p_mese: meseCorrente() })
  if (error) {
    // Meglio far passare la spedizione che fermare la piattaforma per un errore di lettura:
    // il limite e' una regola commerciale, non un vincolo di sicurezza.
    console.error('[PIANO] lettura limiti fallita', masterId, error.message)
    return NESSUN_LIMITE
  }
  const righe = (data || []) as {
    master_id: string; nome: string; limite: number; usato: number; livello: number
    congelato: boolean; scaduto_dal: string | null
  }[]
  const mio = righe.find(r => r.livello === 0)
  // Limite 0/assente = nessun limite: il master principale non ce l'ha, e chi non ha ancora scelto
  // un piano e' gia' fermato dalla schermata di scelta piano, non serve fermarlo anche qui.
  const oltre = righe.filter(r => Number(r.limite) > 0 && Number(r.usato) >= Number(r.limite))
  // CONGELATO: solo il MIO (livello 0). Quello di un master sopra di me non mi riguarda — lui non
  // vede il portale, ma la sua rete lavora regolarmente.
  const congelati = righe.filter(r => r.congelato && r.livello === 0)
  const limite = Number(mio?.limite || 0)
  const usato = Number(mio?.usato || 0)

  // Quanto manca al congelamento, per l'avviso: si conta solo il MIO, non quello di chi sta sopra
  // (a lui non posso rimediare io, e non deve nemmeno sapere che esiste).
  let giorniPerPagare: number | null = null
  let scadenzaPagamento: string | null = null
  if (mio?.scaduto_dal && !mio.congelato) {
    const passati = (Date.now() - new Date(mio.scaduto_dal).getTime()) / 86400000
    giorniPerPagare = Math.max(0, Math.ceil(GIORNI_TOLLERANZA - passati))
    scadenzaPagamento = new Date(new Date(mio.scaduto_dal).getTime() + GIORNI_TOLLERANZA * 86400000).toISOString()
  }

  const bloccatoDaMe = oltre.some(r => r.livello === 0) || !!mio?.congelato
  return {
    usato, limite,
    perc: limite > 0 ? Math.min(999, Math.round((usato / limite) * 100)) : 0,
    avviso: (limite > 0 && usato >= limite * 0.9) || giorniPerPagare !== null,
    // LE SPEDIZIONI NON SI FERMANO MAI. Ne' per canone non pagato, ne' per limite sfondato.
    //
    // Fermare una spedizione significa fermare il CLIENTE, che non c'entra: lui ha pagato il suo
    // master, il suo pacco deve partire. Chi non e' in regola col canone o ha finito il pacchetto
    // viene chiuso fuori dal PORTALE — non vede e non opera — mentre la sua rete continua a
    // lavorare e i movimenti continuano a entrare nella sua lista, perche' quelle spedizioni
    // gliele sta vendendo comunque. Paga o fa l'upgrade, e riapre tutto senza aver perso nulla.
    bloccato: false,
    bloccatoDaMe,
    congelato: !!mio?.congelato,
    // Fuori dal PROPRIO pacchetto: e' il secondo motivo per cui il portale si chiude. Quello dei
    // master sopra non lo riguarda — loro il pacchetto se lo gestiscono da soli.
    oltreIlMio: oltre.some(r => r.livello === 0),
    // Se sono fermo per entrambe le ragioni, quella da risolvere prima e' il pagamento: senza
    // canone in regola non si puo' nemmeno fare l'upgrade.
    motivo: congelati.length ? 'pagamento' : (oltre.length ? 'limite' : null),
    giorniPerPagare,
    scadenzaPagamento,
  }
}

// Il messaggio da mostrare quando la spedizione viene fermata.
// A chi sta SOTTO non si dice mai CHI ha sfondato il limite: e' il suo fornitore, e i suoi affari
// non sono affari di chi gli sta sotto. Si dice solo di rivolgersi al proprio referente.
export function messaggioBlocco(stato: StatoPiano, puoFareUpgrade: boolean): string {
  if (stato.bloccatoDaMe && puoFareUpgrade) {
    if (stato.motivo === 'pagamento') {
      return 'Il canone non risulta pagato: l\'account è sospeso. Aggiorna il metodo di pagamento da '
        + 'Abbonamento e tutto riparte da solo, anche per i tuoi clienti.'
    }
    return `Hai raggiunto il limite del tuo piano (${stato.limite.toLocaleString('it-IT')} spedizioni al mese): `
      + 'passa a un piano superiore da Abbonamento per riprendere subito a spedire.'
  }
  return 'Spedizioni temporaneamente sospese: contatta il tuo referente.'
}
