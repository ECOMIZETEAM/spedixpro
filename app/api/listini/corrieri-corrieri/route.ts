// Aggancio di un corriere a un LISTINO CORRIERI: è ESATTAMENTE la stessa operazione di
// /api/listini/corriere-corrieri (due editor diversi la chiamano — questa dal Listino Corrieri,
// l'altra dal Listino Clienti). Prima erano due copie identiche che col tempo divergevano
// (commenti/dettagli diversi) = il classico "fix una, dimentica l'altra". Ora c'è UNA sola
// implementazione e questa rotta la ri-esporta.
export { GET, POST } from '../corriere-corrieri/route'
