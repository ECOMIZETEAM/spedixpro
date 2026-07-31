import { pianoById } from '@/lib/piani'

// CAMBI DI PIANO CHE NON VALGONO SUBITO.
//
// Upgrade e downgrade non sono simmetrici:
//
//  · UPGRADE → subito. Lo si fa quando si sta per sfondare il limite e le spedizioni stanno per
//    fermarsi: rimandarlo al mese prossimo lo renderebbe inutile. Si paga solo la differenza.
//
//  · DOWNGRADE e DISDETTA → dal primo del mese dopo. Il mese in corso e' pagato al prezzo alto:
//    abbassare il limite adesso significherebbe togliere qualcosa di gia' pagato e, peggio,
//    bloccare una rete che quel mese aveva gia' spedito piu' del nuovo limite.
//
// Il cambio richiesto resta scritto sul master (`abbonamento_piano_programmato` +
// `abbonamento_programmato_dal`) e viene applicato dal giro del primo del mese.

// Valore convenzionale per "non un altro piano, ma la fine dell'abbonamento".
export const DISDETTA = '__disdetta__'

export function primoDelMeseProssimo(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
}

// Applica il cambio programmato di un master, se e' arrivato il momento. Restituisce i campi da
// scrivere, oppure null se non c'e' niente da fare: cosi' chi chiama decide se scrivere davvero.
export function cambioDaApplicare(m: any, adesso = new Date()): Record<string, any> | null {
  const atteso = m?.abbonamento_piano_programmato
  const dal = m?.abbonamento_programmato_dal
  if (!atteso || !dal) return null
  if (new Date(dal).getTime() > adesso.getTime()) return null

  if (atteso === DISDETTA) {
    return {
      abbonamento_piano: null, abbonamento_limite: null, abbonamento_prezzo: null, abbonamento_mese: null,
      abbonamento_piano_programmato: null, abbonamento_programmato_dal: null,
    }
  }
  const piano = pianoById(atteso)
  if (!piano) return { abbonamento_piano_programmato: null, abbonamento_programmato_dal: null }
  return {
    abbonamento_piano: piano.id, abbonamento_limite: piano.limite, abbonamento_prezzo: piano.prezzo,
    abbonamento_piano_programmato: null, abbonamento_programmato_dal: null,
  }
}

// Descrizione a parole del cambio in attesa, per le schermate.
export function descriviCambio(m: any): { piano: string | null; disdetta: boolean; dal: string } | null {
  const atteso = m?.abbonamento_piano_programmato
  if (!atteso || !m?.abbonamento_programmato_dal) return null
  return {
    piano: atteso === DISDETTA ? null : (pianoById(atteso)?.nome || atteso),
    disdetta: atteso === DISDETTA,
    dal: m.abbonamento_programmato_dal,
  }
}
