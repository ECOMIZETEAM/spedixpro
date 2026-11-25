// LE PAGINE DELLA PROVA «Scopri la nuova versione» (Lorenzo 19/11: Dashboard ed Elenco spedizioni; 20/11: anche la
// Nuova spedizione su una pagina, solo da guardare). Un elenco solo: lo legge il proxy (middleware.ts), che accende la
// prova con «?nuova=1» solo su queste, e il menu della cornice nuova, che lascia cliccabili solo queste.
export const PAGINE_PROVA = new Set([
  '/dashboard', '/dashboard/spedizioni', '/dashboard/spedizioni/nuova',
  '/cliente/dashboard', '/cliente/spedizioni', '/cliente/spedizioni/nuova',
  // il calendario (25/11) nasce già nella grafica nuova
  '/dashboard/calendario', '/cliente/calendario',
])
