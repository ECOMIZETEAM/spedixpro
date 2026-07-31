import { meseCorrente } from '@/lib/piani'

// LIMITE DEL PIANO — lettura dello stato e regola del blocco.
//
// Ogni master vede nel proprio piano il traffico di TUTTA la sua rete: le spedizioni dei suoi
// sotto-master e dei loro clienti sono spedizioni che lui rivende, e consumano il suo pacchetto.
//
// Il blocco invece SCENDE E NON SALE MAI. Se un master sfonda il suo limite si fermano lui, i suoi
// sotto-master e i loro clienti — finche' non fa l'upgrade. Chi sta SOPRA non si ferma: ha il suo
// piano, lo paga, e non deve subire il mancato upgrade di qualcun altro. Per questo il controllo
// guarda la catena dal master della spedizione IN SU: se uno qualsiasi di quei livelli e' oltre il
// proprio limite, la spedizione non parte.
//
// Il conteggio non si fa contando le spedizioni: c'e' un contatore per (master, mese) tenuto da un
// trigger sul database (scripts/limite-piano.sql). Contare a ogni creazione le spedizioni del mese
// dell'intero sotto-albero non regge il volume a cui puntiamo.

export type StatoPiano = {
  usato: number          // spedizioni del mese: mie + di tutta la mia rete
  limite: number         // 0 = nessun limite (il master principale, o chi non ha ancora un piano)
  perc: number           // 0-999
  avviso: boolean        // dal 90% in su
  bloccato: boolean      // io o qualcuno sopra di me e' oltre il limite
  bloccatoDaMe: boolean  // il limite sfondato e' il MIO (quindi l'upgrade lo posso fare io)
}

export const NESSUN_LIMITE: StatoPiano = {
  usato: 0, limite: 0, perc: 0, avviso: false, bloccato: false, bloccatoDaMe: false,
}

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
  const righe = (data || []) as { master_id: string; nome: string; limite: number; usato: number; livello: number }[]
  const mio = righe.find(r => r.livello === 0)
  // Limite 0/assente = nessun limite: il master principale non ce l'ha, e chi non ha ancora scelto
  // un piano e' gia' fermato dalla schermata di scelta piano, non serve fermarlo anche qui.
  const oltre = righe.filter(r => Number(r.limite) > 0 && Number(r.usato) >= Number(r.limite))
  const limite = Number(mio?.limite || 0)
  const usato = Number(mio?.usato || 0)
  return {
    usato, limite,
    perc: limite > 0 ? Math.min(999, Math.round((usato / limite) * 100)) : 0,
    avviso: limite > 0 && usato >= limite * 0.9,
    bloccato: oltre.length > 0,
    bloccatoDaMe: oltre.some(r => r.livello === 0),
  }
}

// Il messaggio da mostrare quando la spedizione viene fermata.
// A chi sta SOTTO non si dice mai CHI ha sfondato il limite: e' il suo fornitore, e i suoi affari
// non sono affari di chi gli sta sotto. Si dice solo di rivolgersi al proprio referente.
export function messaggioBlocco(stato: StatoPiano, puoFareUpgrade: boolean): string {
  if (stato.bloccatoDaMe && puoFareUpgrade) {
    return `Hai raggiunto il limite del tuo piano (${stato.limite.toLocaleString('it-IT')} spedizioni al mese): `
      + 'passa a un piano superiore da Abbonamento per riprendere subito a spedire.'
  }
  return 'Spedizioni temporaneamente sospese: contatta il tuo referente.'
}
