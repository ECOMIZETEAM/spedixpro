// LA SCHEDA DI MOOVEXPRESS SULLO SHOPIFY APP STORE: l'unico posto verso cui il portale manda chi vuole
// collegare un negozio Shopify.
//
// Shopify vuole che l'installazione parta da una sua pagina e vieta di chiedere il dominio del negozio,
// anche ad app gia' installata (requisito 2.3.1). Il portale quindi non chiede il dominio e non avvia
// l'OAuth: al massimo porta alla scheda dell'app, che e' anche il collegamento che la guida chiede ai
// siti esterni ("the Badge should include embedded hyperlinks to your app listing page"). Fino al
// 21/10/2026 la pagina Integrazioni aveva il campo del dominio: 520 tentativi da luglio (117 clienti),
// nessun negozio vero collegato, e il 27% finito su admin.myshopify.com o www.myshopify.com, che la
// pagina ricavava da sola dall'indirizzo dell'admin o del sito.
//
// VUOTA FINCHE' SHOPIFY NON APPROVA L'APP. Il 21/10/2026 https://apps.shopify.com/moovexpress risponde
// 404, e un'app pubblica non approvata si installa solo sui negozi di sviluppo: un pulsante verso la
// scheda porterebbe clienti e revisore su una pagina rotta, e una 404 e' motivo di rifiuto (2.1.1).
// Vuota, la pagina Integrazioni spiega come si collega Shopify e rimanda a Importa Ordini, che legge
// gia' l'export ordini di Shopify.
//
// Dopo l'approvazione ci va l'indirizzo della scheda come lo mostra il Partner Dashboard (Distribution
// → Manage listing), https://apps.shopify.com/<nome>, senza /install in fondo: quel suffisso lo cita un
// utente del forum, nessuna guida. Si cambia con un commit e non con una variabile d'ambiente: una
// NEXT_PUBLIC_* viene scritta nel codice del browser alla build, quindi cambiarla vorrebbe dire
// rilasciare lo stesso, solo senza che il cambio si veda nel diff.
// Nello stesso commit vanno riletti i testi che la costante piena accende (passo Shopify di
// app/cliente/integrazioni/page.tsx) contro la pagina della scelta vera (lib/shopify-pagina-scelta.ts):
// finche' e' vuota non li vede nessuno, e una prima stesura nominava un pulsante che la' non c'era.
export const URL_SCHEDA_APP_SHOPIFY: string = ''

// IL LINK D'INSTALLAZIONE DI SHOPIFY, CHE NON CHIEDE NESSUN DOMINIO. Si apre admin.shopify.com: il cliente
// entra col suo account Shopify, sceglie il negozio e installa; poi Shopify lo rimanda a /enter e da li' alla
// conferma del collegamento (app/api/integrazioni/shopify/collega). Lorenzo il 22/10/2026: «io cliente se
// seleziono Shopify devo poter configurarlo da qui; tanto dopo devo fare accesso su Shopify, quindi non collego
// negozi a caso ma per forza il mio». L'installazione parte comunque su una pagina di Shopify, come vuole il
// requisito 2.3.1, e nessuno scrive il dominio. Provato da Lorenzo il 22/10/2026 sul negozio di sviluppo: dal
// link si arriva alla conferma del collegamento. Prima dell'approvazione Shopify lo lascia usare solo ai negozi
// di sviluppo; ai negozi veri risponde Shopify stesso. client_id e' l'identificativo PUBBLICO dell'app
// (shopify.app.toml), non un segreto.
const LINK_INSTALLAZIONE_SHOPIFY = 'https://admin.shopify.com/oauth/install?client_id=f7dfecdb8cb05f8874cd0db742121578'

// Dove porta il pulsante «Collega da Shopify»: la scheda dell'App Store quando ci sara', fino ad allora il link
// d'installazione.
export const LINK_COLLEGA_SHOPIFY: string = URL_SCHEDA_APP_SHOPIFY || LINK_INSTALLAZIONE_SHOPIFY

// Per chi prova a collegare un sito Shopify come WooCommerce o PrestaShop. Non «collegalo dalla sezione
// Shopify» col dominio: li' non si scrive piu' niente, si passa da Shopify col pulsante.
export const COME_SI_COLLEGA_SHOPIFY: string =
  "Shopify si collega dalla sezione Shopify delle Integrazioni: premi «Collega da Shopify», entra con il tuo account Shopify e scegli il negozio."
