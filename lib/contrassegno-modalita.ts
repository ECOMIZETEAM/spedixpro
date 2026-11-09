// COME SI INCASSA IL CONTRASSEGNO SUI CONTRATTI POSTE (SDA EXPRESS L, via KSync).
//
// Poste incassa il contrassegno in tre modi, ognuno col suo massimo (provati sull'ambiente di prova il
// 29/10/2026): contanti (CON) fino a 1.999,99 €, assegno bancario (ABM) e assegno circolare (ACM) fino a
// 12.499,99 €. Fino al 09/11/2026 partiva sempre CON, il valore fisso del contratto: un contrassegno da
// 2.415 € di un cliente di Wave e' stato rifiutato nove volte, e non c'era modo di chiederlo con assegno.
// Lorenzo, 09/11/2026: "metti tutti quelli che sono disponibili e accetta SDA EXPRESS L".
//
// I massimi NON stanno qui: li decide Poste, e possono cambiare (per i contanti si e' chiesto di alzarlo).
// Il suo rifiuto riporta il massimo, e lo traduce erroreCorrierePulito.
//
// Niente import: lo usano anche i moduli del portale, che girano nel browser.

export type ModalitaCod = 'CON' | 'ABM' | 'ACM'

// Il valore arriva dal modulo del portale e dall'API pubblica con gli stessi codici che l'API usa gia' per
// GLS (C / AB / AC, e A per "assegno"), oppure direttamente coi codici di Poste. Vuoto o sconosciuto = null:
// decide il valore del contratto.
export function modalitaCodDaRichiesta(v: unknown): ModalitaCod | null {
  const s = String(v ?? '').trim().toUpperCase()
  if (s === 'C' || s === 'CON' || s === 'CONT' || s === 'CONTANTE' || s === 'CONTANTI') return 'CON'
  if (s === 'AB' || s === 'ABM' || s === 'A' || s === 'BM') return 'ABM'
  if (s === 'AC' || s === 'ACM') return 'ACM'
  return null
}

// La modalita' da mandare a Poste: quella chiesta, se e' una delle tre; se no quella del contratto; se no
// contanti (com'era sempre stato).
export function modalitaCodPoste(richiesta: unknown, delContratto: unknown): ModalitaCod {
  return modalitaCodDaRichiesta(richiesta) || modalitaCodDaRichiesta(delContratto) || 'CON'
}

// Come si legge nelle liste: LOGIXIA ha chiesto che gli assegni si riconoscano dal codice di Poste.
export function etichettaModalitaCod(m: unknown): string | null {
  const v = String(m ?? '').trim().toUpperCase()
  if (v === 'ABM') return 'ABM – assegno bancario'
  if (v === 'ACM') return 'ACM – assegno circolare'
  if (v === 'CON') return 'Contanti'
  return null
}

// Le voci della tendina "Modalità di incasso contrassegno" per i contratti che finiscono su Poste.
export const OPZIONI_INCASSO_POSTE: [string, string][] = [
  ['C', 'CONTANTE'], ['AB', 'ASSEGNO BANCARIO (ABM)'], ['AC', 'ASSEGNO CIRCOLARE (ACM)'],
]
