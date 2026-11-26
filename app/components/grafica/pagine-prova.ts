// LE PAGINE DELLA PROVA «Scopri la nuova versione» (Lorenzo 19/11: Dashboard ed Elenco spedizioni; 20/11: anche la
// Nuova spedizione su una pagina, solo da guardare). Un elenco solo: lo legge il proxy (middleware.ts), che accende la
// prova con «?nuova=1» solo su queste, e il menu della cornice nuova, che lascia cliccabili solo queste.
export const PAGINE_PROVA = new Set([
  '/dashboard', '/dashboard/spedizioni', '/dashboard/spedizioni/nuova',
  '/cliente/dashboard', '/cliente/spedizioni', '/cliente/spedizioni/nuova',
  // il calendario (25/11) nasce già nella grafica nuova
  '/dashboard/calendario', '/cliente/calendario',
  // 26/11, col vestito comune (vestito.css), fotografate coi dati veri di giorno, di notte e sul telefono
  '/dashboard/spedizioni/giacenze', '/dashboard/spedizioni/rettifica', '/dashboard/spedizioni/cancellate',
  '/dashboard/contrassegni', '/dashboard/ritiri/elenco', '/dashboard/distinte/elenco', '/dashboard/distinte/crea',
  '/dashboard/resi/distinte', '/dashboard/network', '/dashboard/listini', '/dashboard/clienti', '/dashboard/movimenti',
  '/dashboard/reports/spedizioni', '/dashboard/statistiche/profitto', '/dashboard/impostazioni', '/dashboard/costi-gestione',
  // 26/11 pomeriggio, i report: col calendario delle date e la tendina con la ricerca vestiti come gli altri campi
  '/dashboard/reports/agenti', '/dashboard/reports/consumabili', '/dashboard/reports/contrassegni', '/dashboard/reports/distinte',
  '/dashboard/reports/fatture', '/dashboard/reports/giacenze', '/dashboard/reports/resi', '/dashboard/reports/rettifiche',
  '/dashboard/reports/ricariche', '/dashboard/reports/ritiri', '/dashboard/reports/sms-clienti', '/dashboard/reports/storico-sms',
  // 26/11 sera, le Statistiche: grafici e numeri grandi nei colori della dashboard. L'estratto conto no: visto solo vuoto
  // (leggerlo scrive, riprova gli abbinamenti dei bonifici)
  '/dashboard/statistiche/check-ricariche', '/dashboard/statistiche/clienti', '/dashboard/statistiche/contrassegni',
  '/dashboard/statistiche/corrieri', '/dashboard/statistiche/fatturazione', '/dashboard/statistiche/rettifiche-auto',
  '/dashboard/statistiche/salute-conto',
])

// LE PAGINE COL LORO DISEGNO nella grafica nuova (Dashboard, Elenco, Nuova spedizione, Calendario): tutte le altre, dentro
// la cornice nuova, prendono il vestito comune (grafica/vestito.css, classe gx-vestito sulla pagina). Un elenco a parte
// da quello della prova: una pagina si apre nella prova quando il vestito le sta bene, ma il disegno resta quello comune.
export const PAGINE_DISEGNATE = new Set([
  '/dashboard', '/dashboard/spedizioni', '/dashboard/spedizioni/nuova', '/dashboard/calendario',
  '/cliente/dashboard', '/cliente/spedizioni', '/cliente/spedizioni/nuova', '/cliente/calendario',
])
