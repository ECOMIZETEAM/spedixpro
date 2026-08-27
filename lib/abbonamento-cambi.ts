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

// CONGUAGLIO DEI CAMBI DI PIANO A META' MESE.
//
// Un upgrade a meta' mese NON fa pagare subito la differenza piena del piano: fa pagare, al prossimo
// rinnovo, la differenza PROPORZIONATA ai giorni che restano nel mese. La regola, decisa da chi
// vende (confermata il 27/08):
//
//   conguaglio = (prezzo_nuovo − prezzo_vecchio) / giorni_del_mese × giorni_dal_cambio_a_fine_mese
//
// I giorni sono inclusivi: chi passa il 16 di agosto paga per 16 giorni (16→31). Con piu' upgrade
// nello stesso mese (5k→10k→20k) ogni salto parte dal prezzo del piano precedente, quindi la somma
// e' esatta: non si paga due volte lo stesso pezzo.
//
// Perche' proporzionata e non piena: chi passa il 28 userebbe il piano grande tre giorni e pagare la
// differenza intera sarebbe ingiusto. Il rinnovo del mese dopo e' comunque pieno.
//
// I giorni si leggono in UTC, come sono scritte le date sul database, cosi' il numero mostrato al
// master e quello addebitato dal circuito coincidono al centesimo.
export function giorniNelMese(mese: string): number {
  const [a, m] = mese.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()   // giorno 0 del mese dopo = ultimo del mese
}

export type VoceConguaglio = { piano: string; giornoCambio: number; giorniRestanti: number; importo: number }

// Dalle righe di `abbonamenti_pagamenti` di UN mese (ognuna porta piano + created_at) ricostruisce
// la scaletta dei piani e somma il conguaglio di ogni upgrade. Le righe possono arrivare in
// qualsiasi ordine: si riordinano per data. Downgrade e ripetizioni dello stesso piano non generano
// conguaglio (solo i salti in su, prezzo che cresce).
export function conguaglioDelMese(
  righe: Array<{ piano?: string | null; created_at?: string | null }>,
  mese: string,
): { totale: number; dettaglio: VoceConguaglio[] } {
  const giorni = giorniNelMese(mese)
  const ordinate = [...righe].filter(r => r.piano).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  let prezzoPrec: number | null = null
  let totale = 0
  const dettaglio: VoceConguaglio[] = []
  for (const r of ordinate) {
    const pi = pianoById(r.piano!); if (!pi) continue
    if (prezzoPrec != null && pi.prezzo > prezzoPrec) {   // solo gli UPGRADE
      const giorno = r.created_at ? new Date(r.created_at).getUTCDate() : 1
      const restanti = Math.max(0, giorni - giorno + 1)
      const q = Math.round(((pi.prezzo - prezzoPrec) / giorni * restanti) * 100) / 100
      totale += q
      dettaglio.push({ piano: pi.nome, giornoCambio: giorno, giorniRestanti: restanti, importo: q })
    }
    prezzoPrec = pi.prezzo
  }
  return { totale: Math.round(totale * 100) / 100, dettaglio }
}

// DA QUANDO IL CANONE SI PAGA CON CARTA.
//
// Fino a ieri il canone si scalava dal credito, in silenzio: i master non hanno mai ricevuto un
// avviso. Farli trovare congelati senza preavviso sarebbe stato scorretto verso di loro e dannoso
// per noi — i tre piu' grossi valgono quasi 8.000 spedizioni al mese, e con loro si fermerebbero
// anche i loro clienti.
//
// Quindi il conto alla rovescia non parte prima di questa data: e' il tempo per avvisarli. Passata,
// questa riga non ha piu' alcun effetto e la regola vale sempre e per tutti.
export const INIZIO_OBBLIGO_CARTA = new Date('2026-08-03T06:00:00Z')
