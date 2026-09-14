import { useSyncExternalStore } from 'react'

// L'APP iOS/ANDROID È UN'ALTRA VETRINA, CON REGOLE SUE.
//
// Apple e Google pretendono che abbonamenti e servizi digitali comprati DENTRO l'app passino dal
// loro sistema di pagamento: un "Attiva con carta" che apre Stripe è motivo di rifiuto, e lo è anche
// un invito a pagare altrove. Nell'app quindi non compare nessun acquisto di canone, pacchetti API o
// SMS, solo un testo neutro; sul web resta tutto com'è. Restano invece spedizioni e ricarica del
// credito: pagano un servizio fisico, che le regole degli store lasciano pagare come si vuole.
//
// Non è una regola di soldi né una difesa: chi falsifica il marchio nasconde a sé stesso dei
// pulsanti, e le rotte di pagamento restano quelle di sempre.
//
// L'app si riconosce dal marchio che il guscio aggiunge allo user agent (appendUserAgent in
// capacitor.config.json del progetto moovexpress-app): se lo si cambia là, va cambiato qui.
const MARCHIO_APP = 'MoovExpressApp/'

export const ABBONAMENTO_NON_IN_APP = 'La gestione dell’abbonamento non è disponibile nell’app.'

export function isAppNativa(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(MARCHIO_APP)
}

const nessunCambio = () => () => {}

// Sul server e al primo disegno dell'idratazione vale false (il server non sa chi c'è dall'altra
// parte), poi React rilegge sul telefono senza errori di idratazione. Per questo un acquisto che
// finisce già nell'HTML del server va mostrato solo dopo i suoi dati: altrimenti nell'app lo si
// vedrebbe per un istante prima di sparire.
export function useAppNativa(): boolean {
  return useSyncExternalStore(nessunCambio, isAppNativa, () => false)
}
