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

export type VoceConguaglio = { piano: string; giornoDa: number; giornoA: number; giorni: number; importo: number }

// Dalle righe di `abbonamenti_pagamenti` di UN mese (ognuna porta piano + created_at) ricostruisce
// la scaletta dei piani e somma il conguaglio degli upgrade. Le righe possono arrivare in qualsiasi
// ordine: si riordinano per data.
//
// SEGMENTI NON SOVRAPPOSTI. Il primo piano del mese e' la BASE: e' il canone gia' pagato, e copre
// l'intero mese al suo livello. Ogni piano successivo occupa il suo tratto di giorni — dal giorno in
// cui parte fino al giorno prima del cambio dopo (o fine mese) — e su quel tratto si paga solo
// l'EXTRA rispetto alla base. Cosi' i giorni non si sommano oltre il mese: 10k dall'11 al 21 (11
// giorni) + 20k dal 22 al 31 (10 giorni), non "21 + 10". Il totale e' identico al conto giorno per
// giorno: canone base + somma degli extra = quanto avrebbe pagato pagando ogni giorno al suo piano.
//
// Solo salti in SU rispetto alla base generano conguaglio: un downgrade non da' mai rimborso.
export function conguaglioDelMese(
  righe: Array<{ piano?: string | null; created_at?: string | null }>,
  mese: string,
): { totale: number; dettaglio: VoceConguaglio[] } {
  const giorni = giorniNelMese(mese)
  const ordinate = [...righe].filter(r => r.piano)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  // Scaletta piano→giorno, saltando le ripetizioni dello stesso prezzo (rinnovo + conferma, ecc.).
  const tappe: { prezzo: number; nome: string; giorno: number }[] = []
  for (const r of ordinate) {
    const pi = pianoById(r.piano!); if (!pi) continue
    const giorno = r.created_at ? new Date(r.created_at).getUTCDate() : 1
    if (tappe.length && tappe[tappe.length - 1].prezzo === pi.prezzo) continue
    tappe.push({ prezzo: pi.prezzo, nome: pi.nome, giorno })
  }
  if (tappe.length < 2) return { totale: 0, dettaglio: [] }

  const base = tappe[0].prezzo
  let totale = 0
  const dettaglio: VoceConguaglio[] = []
  for (let i = 1; i < tappe.length; i++) {
    const t = tappe[i]
    if (t.prezzo <= base) continue                                  // non sopra la base: nessun extra
    const giornoDa = t.giorno
    const giornoA = i + 1 < tappe.length ? tappe[i + 1].giorno - 1 : giorni   // fino al cambio dopo, o fine mese
    const gg = Math.max(0, giornoA - giornoDa + 1)
    const q = Math.round(((t.prezzo - base) / giorni * gg) * 100) / 100
    totale += q
    dettaglio.push({ piano: t.nome, giornoDa, giornoA, giorni: gg, importo: q })
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
