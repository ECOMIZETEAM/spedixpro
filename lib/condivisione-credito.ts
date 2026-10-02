// LE CONDIZIONI DI PAGAMENTO DI UN COLLEGAMENTO FRA MASTER, SCRITTE IN UN MODO SOLO.
//
// La stessa cosa vive in due righe diverse del database:
//  - `corrieri_condivisi.credito_modo`  → 'prepagato' | 'fattura'   (il collegamento, lato venditore)
//  - `clienti.tipo_contratto`           → 'credito_scalare' | 'fattura_mensile'  (il conto, ciò che
//    guardano il motore del credito, le fatture, i report e la scheda cliente)
//
// Finché i due vocabolari non si parlavano, la rotta del collegamento scriveva sul conto la parola
// 'fattura', che nel resto della piattaforma NON ESISTE. Effetti veri (visti in produzione il 2/10 su
// 2 conti-ingrosso): nella scheda cliente la tendina non trovava il valore e mostrava la prima voce
// ("Credito a scalare") pur essendo a fattura; chi salvava da lì rimetteva 'credito_scalare' e il
// collegamento, al primo tocco, riscriveva 'fattura' — il campo sembrava tornare indietro da solo.
// Anche i conteggi "a fattura / a credito" della home contavano quel conto nel gruppo sbagliato.
//
// Qui la conversione, nei due versi, una volta sola. Chi scrive una delle due righe aggiorna anche
// l'altra passando da qui.

export type CreditoModo = 'prepagato' | 'fattura'
export type TipoContratto = 'credito_scalare' | 'fattura_mensile'

export function tipoContrattoDaCreditoModo(modo: string | null | undefined): TipoContratto {
  return String(modo || '') === 'fattura' ? 'fattura_mensile' : 'credito_scalare'
}

export function creditoModoDaTipoContratto(tipo: string | null | undefined): CreditoModo {
  // Tutto ciò che non è 'credito_scalare' il motore lo tratta come "può andare sotto zero"
  // (app/api/spedizioni/crea: blocca solo su 'credito_scalare'), quindi è "a fattura".
  return String(tipo || '') === 'credito_scalare' ? 'prepagato' : 'fattura'
}
