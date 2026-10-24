// LA CARTA PER IL CREDITO DEI CLIENTI: UN INTERRUTTORE SOLO.
//
// Le ricariche con carta sono sospese per decisione del super master: niente cassa nella pagina
// Ricarica credito, niente addebito sulla carta salvata dal riquadro "credito insufficiente". Fino al
// 21/10/2026 l'interruttore era copiato in tre punti (la pagina e le rotte ricarica e paga-carta), e il
// riquadro non ne leggeva nessuno: a ogni cliente a credito scalare senza credito sufficiente mostrava
// "Paga con la carta e spedisci", e la rotta rispondeva 503 a tutti. Un negozio appena installato da
// Shopify nasce con credito 0: alla prima spedizione trovava quel pulsante, e non funzionava mai.
//
// Ora lo leggono tutti e quattro da qui. Con la carta sospesa il riquadro e la pagina mostrano i dati
// per il bonifico del master del cliente (decisione di Lorenzo del 21/10/2026, per tutti i clienti).
// Il codice della carta e' rimasto com'era: per riaccenderla basta false.
//
// Nessuna dipendenza: lo importano le rotte del server e i componenti del browser ('use client').

// `boolean` e non il letterale `true`: tsc deve continuare a controllare anche il ramo della carta.
export const RICARICHE_CARTA_SOSPESE: boolean = true
