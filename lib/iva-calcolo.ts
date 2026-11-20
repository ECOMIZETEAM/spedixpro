// COME SI DIVIDE UN PREZZO IN IMPONIBILE E IVA, SECONDO COME E' STATO VENDUTO (Lorenzo, 20/11/2026).
//
// Un master vende i listini IVA esclusa o IVA inclusa, anche corriere per corriere (scripts/iva-listini.sql).
// Il credito scala SEMPRE il prezzo del listino: 4,00 € venduti IVA esclusa scalano 4,00, non 4,88.
// Cambia solo come i documenti leggono quei 4,00:
//   - IVA esclusa: imponibile 4,00 + IVA 0,88 da incassare a parte, totale 4,88;
//   - IVA inclusa: imponibile 3,28 + IVA 0,72 gia' dentro, totale 4,00 (scorporo).
// Prima di oggi ogni report trattava tutto come IVA esclusa: sui listini venduti IVA inclusa il 22%
// finiva sopra un prezzo che lo conteneva gia'.
//
// Nessun arrotondamento qui: chi somma tante righe arrotonda alla fine, come i report hanno sempre
// fatto. Su una riga IVA esclusa i numeri sono identici a quelli di prima, al centesimo.
// File senza dipendenze dal server: lo usano anche i report generati nel browser.

export type ParteIva = { imponibile: number; iva: number; totale: number }

export function dividiPrezzo(prezzo: number, aliquota: number, inclusa: boolean): ParteIva {
  const p = Number(prezzo) || 0
  const a = Number(aliquota) || 0
  if (!inclusa) {
    const iva = p * a / 100
    return { imponibile: p, iva, totale: p + iva }
  }
  const imponibile = p / (1 + a / 100)
  return { imponibile, iva: p - imponibile, totale: p }
}

// Il riepilogo di un gruppo di righe: quanto e' uscito dal credito, quanta IVA c'era gia' dentro e
// quanta resta da incassare a parte. E' il riquadro in fondo ai report quando c'e' almeno una riga
// venduta IVA inclusa.
export type SommaIva = {
  scalato: number        // somma dei prezzi = quello che i movimenti hanno scalato
  imponibile: number
  iva: number
  totale: number
  ivaCompresa: number    // IVA delle righe IVA inclusa: e' gia' dentro lo scalato
  ivaDaIncassare: number // IVA delle righe IVA esclusa: va chiesta a parte
  nInclusa: number
  nEsclusa: number
}

export function sommaVuota(): SommaIva {
  return { scalato: 0, imponibile: 0, iva: 0, totale: 0, ivaCompresa: 0, ivaDaIncassare: 0, nInclusa: 0, nEsclusa: 0 }
}

export function aggiungiRiga(s: SommaIva, prezzo: number, aliquota: number, inclusa: boolean): SommaIva {
  const d = dividiPrezzo(prezzo, aliquota, inclusa)
  s.scalato += Number(prezzo) || 0
  s.imponibile += d.imponibile
  s.iva += d.iva
  s.totale += d.totale
  if (inclusa) { s.ivaCompresa += d.iva; s.nInclusa++ } else { s.ivaDaIncassare += d.iva; s.nEsclusa++ }
  return s
}

export function unisciSomme(a: SommaIva, b: SommaIva): SommaIva {
  return {
    scalato: a.scalato + b.scalato, imponibile: a.imponibile + b.imponibile, iva: a.iva + b.iva, totale: a.totale + b.totale,
    ivaCompresa: a.ivaCompresa + b.ivaCompresa, ivaDaIncassare: a.ivaDaIncassare + b.ivaDaIncassare,
    nInclusa: a.nInclusa + b.nInclusa, nEsclusa: a.nEsclusa + b.nEsclusa,
  }
}

// Come e' venduto un gruppo: per la colonna "Prezzi" del riepilogo.
export function modoGruppo(s: SommaIva): 'IVA inclusa' | 'IVA esclusa' | 'misto' {
  if (s.nInclusa && s.nEsclusa) return 'misto'
  return s.nInclusa ? 'IVA inclusa' : 'IVA esclusa'
}

// ── L'ETICHETTA ACCANTO AI PREZZI (Lorenzo, 20/11/2026: "fai il + IVA visibile") ──────────────────
// Chi compra vede come e' scritto il prezzo: "IVA escl." se il listino e' venduto IVA esclusa, "IVA incl."
// se inclusa (Lorenzo, 20/11: "IVA escl." e non "+ IVA").
// SOLO DOVE IL MASTER HA SCELTO (lib/iva-vendita.ts → infoIvaPrezzi): altrimenti nessuna etichetta. Prima vedeva "4,00 €" e basta, e non poteva sapere quale dei due fosse.
// Niente etichetta a chi ha l'aliquota allo 0% (esenti, lettere d'intento): li' non c'e' IVA da
// aggiungere, e "IVA escl." sarebbe fuorviante.

// `listino` null = il master non ha scelto per tutto il listino: valgono solo i contratti scelti a parte.
export type InfoIvaPrezzi = { aliquota: number; listino: boolean | null; corrieri: Record<string, boolean | null> }

export function ivaDelCorriere(info: InfoIvaPrezzi | null | undefined, corriereId: string | null | undefined): boolean | null {
  if (!info) return null
  const v = corriereId ? info.corrieri?.[corriereId] : null
  return v == null ? (info.listino ?? null) : v
}

export function testoIva(inclusa: boolean | null | undefined, aliquota?: number | null): string {
  if (inclusa == null) return ''
  if (aliquota != null && Number(aliquota) === 0) return ''
  return inclusa ? 'IVA incl.' : 'IVA escl.'
}

// Per un totale: l'etichetta solo se tutti i prezzi dentro sono scritti allo stesso modo.
export function testoIvaGruppo(inclusa: (boolean | null | undefined)[], aliquota?: number | null): string {
  const noti = inclusa.filter(v => v != null) as boolean[]
  if (!noti.length || noti.length !== inclusa.length) return ''
  if (noti.some(v => v !== noti[0])) return ''
  return testoIva(noti[0], aliquota)
}
