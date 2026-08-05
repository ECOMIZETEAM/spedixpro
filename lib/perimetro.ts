// CHI PUO' GUARDARE LA RETE, E CHI NO.
//
// Diverse rotte accettano un parametro "m:<id master>" per farsi dare i dati di un sotto-master.
// Quel ramo, per costruzione, usa il client amministrativo — che SCAVALCA la RLS — e si affida al
// controllo scritto a mano nella rotta. Il controllo era `if (masterSel && utente?.master_id)`,
// e il master_id ce l'hanno anche gli utenti cliente e gli agenti: bastava passare l'id del
// proprio master per uscire dal proprio perimetro e leggere tutta la rete.
//
// Non e' una svista di una rotta sola: lo stesso pezzo era copiato in sei posti. Quindi la regola
// sta qui, una volta, e le rotte la chiamano. Chi la scrive di nuovo a mano sbagliera' di nuovo.
// Il tipo di ritorno non e' `boolean` ma una GARANZIA: chi supera questo controllo ha un
// master_id, e da qui in poi il compilatore lo sa. Serve a qualcosa di concreto — nelle rotte
// il passo successivo e' sempre `utente.master_id`, e senza la garanzia si finiva col mettere un
// punto interrogativo o un punto esclamativo a caso pur di far compilare, che e' esattamente il
// gesto con cui un controllo di perimetro si annacqua.
export function vedeLaRete(utente: any): utente is { master_id: string; ruolo?: string } {
  const ruolo = String(utente?.ruolo || '').toLowerCase()
  if (!utente?.master_id) return false
  // Il cliente vede se stesso. L'agente vede i propri clienti, mai la rete: e' un rivenditore,
  // non un master. L'autista vede il giro di consegne che ha in mano, e basta.
  // Restano dentro i ruoli che la rete la governano davvero: master, admin, operatore.
  return ruolo !== 'cliente' && ruolo !== 'agente' && ruolo !== 'autista'
}
