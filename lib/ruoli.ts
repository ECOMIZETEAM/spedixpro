// CHI PUO' MUOVERE I SOLDI DELLA RETE.
//
// `master_id` NON E' UN PERMESSO: ce l'hanno anche i 769 utenti cliente e gli autisti, perche' dice
// a quale rete uno appartiene, non che comandi qualcosa. Una rotta che si limita a filtrare per
// master_id lascia passare il cliente — che cosi' puo' leggere, e in un caso cancellare, l'addebito
// che sta per pagare. E quando la rotta scrive con la chiave di servizio le regole per riga non
// fanno da rete: il permesso va controllato a mano, qui.
//
// I ruoli veri sono cinque: master, admin, operatore (lo staff del master, che lavora nel portale
// ogni giorno), agente (rivenditore in SOLA LETTURA sui propri clienti) e autista. Piu' cliente.
//
// Scritta a mano rotta per rotta, questa distinzione e' gia' uscita diversa in posti diversi: da
// qualche parte "e' un master" voleva dire `ruolo === 'master'` e l'operatore restava fuori dal suo
// lavoro, da un'altra parte bastava avere un master_id e passava il cliente. Sta qui, una volta.

export type UtenteRuolo = { ruolo?: string | null } | null | undefined

const r = (u: UtenteRuolo) => String(u?.ruolo || '').toLowerCase()

/** Lavora nel portale del master: puo' vedere e muovere le cose della rete. Non l'agente, che e' in
 *  sola lettura e ha una sua strada, non il cliente, non l'autista. */
export function gestisceLaRete(u: UtenteRuolo): boolean {
  return r(u) === 'master' || r(u) === 'admin' || r(u) === 'operatore'
}

/** Puo' almeno GUARDARE le cose della rete: come sopra, piu' l'agente, che vede pero' soltanto i
 *  propri clienti — il filtro per cliente resta a carico di chi chiama. */
export function vedeLaRete(u: UtenteRuolo): boolean {
  return gestisceLaRete(u) || r(u) === 'agente'
}
