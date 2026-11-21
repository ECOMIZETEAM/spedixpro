// COME SI DIVIDE UN PREZZO IN IMPONIBILE E IVA, SECONDO COME E' STATO VENDUTO (Lorenzo, 20/11/2026).
//
// Un master vende i listini IVA esclusa, IVA inclusa o ESENTE IVA (21/11/2026), anche corriere per
// corriere (scripts/iva-listini.sql, scripts/iva-esente.sql).
// Il credito scala SEMPRE il prezzo del listino: 4,00 € venduti IVA esclusa scalano 4,00, non 4,88.
// Cambia solo come i documenti leggono quei 4,00:
//   - IVA esclusa: imponibile 4,00 + IVA 0,88 da incassare a parte, totale 4,88;
//   - IVA inclusa: imponibile 3,28 + IVA 0,72 gia' dentro, totale 4,00 (scorporo);
//   - esente IVA: 4,00 esenti, IVA 0, totale 4,00 — anche se il cliente ha il 22%.
// Prima del 20/11 ogni report trattava tutto come IVA esclusa: sui listini venduti IVA inclusa il 22%
// finiva sopra un prezzo che lo conteneva gia'.
//
// L'esente NON e' imponibile: sta in `esente`, a parte, e il totale e' imponibile + IVA + esente. Cosi'
// l'IVA del documento (imponibile × aliquota) non puo' finire anche sulle righe esenti.
//
// Nessun arrotondamento qui: chi somma tante righe arrotonda alla fine, come i report hanno sempre
// fatto. Su una riga IVA esclusa i numeri sono identici a quelli di prima, al centesimo.
// File senza dipendenze dal server: lo usano anche i report generati nel browser.

export type RegimeIva = 'inclusa' | 'esclusa' | 'esente'

// Accetta anche il si'/no di prima (true = IVA inclusa): un valore assente e' IVA esclusa, come i report di sempre.
export function regimeDi(v: RegimeIva | boolean | null | undefined): RegimeIva {
  if (v === 'inclusa' || v === 'esclusa' || v === 'esente') return v
  return v === true ? 'inclusa' : 'esclusa'
}

export type ParteIva = { imponibile: number; iva: number; totale: number; esente: number }

export function dividiPrezzo(prezzo: number, aliquota: number, modo: RegimeIva | boolean | null | undefined): ParteIva {
  const p = Number(prezzo) || 0
  const a = Number(aliquota) || 0
  const r = regimeDi(modo)
  if (r === 'esente') return { imponibile: 0, iva: 0, totale: p, esente: p }
  if (r === 'esclusa') {
    const iva = p * a / 100
    return { imponibile: p, iva, totale: p + iva, esente: 0 }
  }
  const imponibile = p / (1 + a / 100)
  return { imponibile, iva: p - imponibile, totale: p, esente: 0 }
}

// Il riepilogo di un gruppo di righe: quanto e' uscito dal credito, quanta IVA c'era gia' dentro, quanta
// resta da incassare a parte, quanto e' esente. E' il riquadro in fondo ai report quando c'e' almeno una
// riga venduta IVA inclusa o esente.
export type SommaIva = {
  scalato: number        // somma dei prezzi = quello che i movimenti hanno scalato
  imponibile: number     // senza le righe esenti
  iva: number
  totale: number         // imponibile + iva + esente
  ivaCompresa: number    // IVA delle righe IVA inclusa: e' gia' dentro lo scalato
  ivaDaIncassare: number // IVA delle righe IVA esclusa: va chiesta a parte
  esente: number         // prezzi delle righe esenti: niente IVA
  nInclusa: number
  nEsclusa: number
  nEsente: number
}

export function sommaVuota(): SommaIva {
  return { scalato: 0, imponibile: 0, iva: 0, totale: 0, ivaCompresa: 0, ivaDaIncassare: 0, esente: 0, nInclusa: 0, nEsclusa: 0, nEsente: 0 }
}

export function aggiungiRiga(s: SommaIva, prezzo: number, aliquota: number, modo: RegimeIva | boolean | null | undefined): SommaIva {
  const r = regimeDi(modo)
  const d = dividiPrezzo(prezzo, aliquota, r)
  s.scalato += Number(prezzo) || 0
  s.imponibile += d.imponibile
  s.iva += d.iva
  s.totale += d.totale
  if (r === 'esente') { s.esente += d.esente; s.nEsente++ }
  else if (r === 'inclusa') { s.ivaCompresa += d.iva; s.nInclusa++ }
  else { s.ivaDaIncassare += d.iva; s.nEsclusa++ }
  return s
}

export function unisciSomme(a: SommaIva, b: SommaIva): SommaIva {
  return {
    scalato: a.scalato + b.scalato, imponibile: a.imponibile + b.imponibile, iva: a.iva + b.iva, totale: a.totale + b.totale,
    ivaCompresa: a.ivaCompresa + b.ivaCompresa, ivaDaIncassare: a.ivaDaIncassare + b.ivaDaIncassare, esente: a.esente + b.esente,
    nInclusa: a.nInclusa + b.nInclusa, nEsclusa: a.nEsclusa + b.nEsclusa, nEsente: a.nEsente + b.nEsente,
  }
}

// Come e' venduto un gruppo: per la colonna "Prezzi" del riepilogo.
export function modoGruppo(s: SommaIva): 'IVA inclusa' | 'IVA esclusa' | 'Esente IVA' | 'misto' {
  if ([s.nInclusa, s.nEsclusa, s.nEsente].filter(n => n > 0).length > 1) return 'misto'
  if (s.nEsente) return 'Esente IVA'
  return s.nInclusa ? 'IVA inclusa' : 'IVA esclusa'
}

// ── L'ETICHETTA ACCANTO AI PREZZI (Lorenzo, 20/11/2026: "fai il + IVA visibile") ──────────────────
// Chi compra vede come e' scritto il prezzo: "IVA escl." se il listino e' venduto IVA esclusa, "IVA incl."
// se inclusa (Lorenzo, 20/11: "IVA escl." e non "+ IVA"), "Esente IVA" se esente (21/11).
// SOLO DOVE IL MASTER HA SCELTO (lib/iva-vendita.ts → infoIvaPrezzi): altrimenti nessuna etichetta. Prima vedeva "4,00 €" e basta, e non poteva sapere quale dei due fosse.
// Niente "IVA escl." / "IVA incl." a chi ha l'aliquota allo 0% (esenti, lettere d'intento): li' non c'e'
// IVA da aggiungere, e "IVA escl." sarebbe fuorviante. "Esente IVA" invece si': l'ha scelto il master.

// `listino` null = il master non ha scelto per tutto il listino: valgono solo i contratti scelti a parte.
export type InfoIvaPrezzi = { aliquota: number; listino: RegimeIva | null; corrieri: Record<string, RegimeIva | null> }

export function ivaDelCorriere(info: InfoIvaPrezzi | null | undefined, corriereId: string | null | undefined): RegimeIva | null {
  if (!info) return null
  const v = corriereId ? info.corrieri?.[corriereId] : null
  return v == null ? (info.listino ?? null) : v
}

// Il si'/no di prima, per le pagine aperte prima del rilascio del 21/11 (si toglie al prossimo giro). Esente
// diventa null: la pagina vecchia non mostra niente, invece di scrivere "IVA escl." su un prezzo esente.
export function siNoVecchio(regime: RegimeIva | null | undefined): boolean | null {
  return regime === 'inclusa' ? true : regime === 'esclusa' ? false : null
}

export function testoIva(regime: RegimeIva | null | undefined, aliquota?: number | null): string {
  if (regime == null) return ''
  if (regime === 'esente') return 'Esente IVA'
  if (aliquota != null && Number(aliquota) === 0) return ''
  return regime === 'inclusa' ? 'IVA incl.' : 'IVA escl.'
}

// Per un totale: l'etichetta solo se tutti i prezzi dentro sono scritti allo stesso modo.
export function testoIvaGruppo(regimi: (RegimeIva | null | undefined)[], aliquota?: number | null): string {
  const noti = regimi.filter(v => v != null) as RegimeIva[]
  if (!noti.length || noti.length !== regimi.length) return ''
  if (noti.some(v => v !== noti[0])) return ''
  return testoIva(noti[0], aliquota)
}
