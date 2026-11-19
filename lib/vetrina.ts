/* CHI C'E' DIETRO IL SITO PUBBLICO (www.moovexpress.com).
 *
 * Il MASTER sotto cui nasce chi si registra dal sito (clienti e richieste di rivenditori) e il
 * LISTINO con cui il sito fa i preventivi e con cui i clienti nuovi pagano.
 *
 * Stanno qui, e non scritti in ogni rotta, perche' devono essere gli STESSI nelle tre porte del sito
 * (app/api/pubblico/tariffe, /registrazione, /registrazione-master): se il preventivo prezzasse un
 * listino e la registrazione agganciasse il cliente a un altro, il visitatore vedrebbe un prezzo e
 * ne pagherebbe un altro. Prima erano tre copie della stessa costante.
 *
 * MOOVY dal 27/10/2026 (prima MULTIEXPRESS, decisione di Lorenzo). Il listino e' la copia identica
 * del "Listino Standard Web" di MULTIEXPRESS, con contratti e zone di MOOVY: un listino cliente
 * punta alle zone del SUO master, con quelle di un altro il motore non trova la destinazione.
 * MOOVY compra da MULTIEXPRESS a costo pieno ("Listino MOOVY a costo"): ai clienti del sito i
 * prezzi non sono cambiati di un centesimo, verificato rieseguendo preventivo, addebito e costo
 * del livello sopra, vecchio contro nuovo, su spedizioni vere e destinazioni difficili. */

export const MASTER_VETRINA = '5c32dead-fa08-4b06-abaa-0e4adeb90091'    // MOOVY
export const LISTINO_VETRINA = '7304d0c2-d8d8-4194-b497-2b36d13e6807'   // Listino Standard Web di MOOVY
