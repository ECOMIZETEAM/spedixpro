// COSA SI VOTA nella prova della grafica nuova. Lorenzo 19/11: un voto sulla nuova versione; 20/11: un voto a parte per
// la Nuova spedizione su una pagina. Un voto per persona e per argomento (vincolo nel database, grafica_voti). Questo
// elenco vale per la rotta (che rifiuta gli argomenti che non conosce), per il sondaggio e per la pagina dei risultati.
export const ARGOMENTI = {
  versione: { domanda: 'Ti piace la nuova MoovExpress?', nome: 'La nuova versione' },
  'nuova-spedizione': { domanda: 'Ti piace la nuova pagina Nuova spedizione?', nome: 'Nuova spedizione' },
} as const

export type Argomento = keyof typeof ARGOMENTI

export const eArgomento = (x: unknown): x is Argomento =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(ARGOMENTI, x)

// dalla pagina in cui si vota: la Nuova spedizione (master o cliente) ha il suo voto, tutto il resto vota la versione
export const argomentoDi = (pagina: string): Argomento =>
  /\/spedizioni\/nuova\/?$/.test(String(pagina || '').split('?')[0]) ? 'nuova-spedizione' : 'versione'
