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

// LE PAGINE DEL SUPER MASTER SI APRONO COL RUOLO E COL MASTER, INSIEME.
// Il rapporto delle giacenze di tutta la piattaforma, i segreti dei webhook in ingresso e gli account
// demo guardavano solo `is_super_master` del master dell'utente. Sotto la radice pero' ci sono anche
// utenti cliente, uno per ogni negozio che installa l'app Shopify pubblica (lib/shopifyProvision.ts):
// con la propria sessione leggevano giacenze, clienti e master di tutta la rete, e potevano registrare
// un segreto del webhook, cioe' firmare eventi di giacenza che aprono addebiti lungo la catena.
// I ruoli ammessi sono quelli che /api/audit e /api/root/api-clienti usano dal 5 agosto: master e admin.
// L'operatore del super master resta fuori finche' non lo decide Lorenzo: si aggiunge qui, una volta.
const RUOLI_SUPER_MASTER = ['master', 'admin']
export async function eStaffDelSuperMaster(
  u: { ruolo?: string | null; master_id?: string | null } | null | undefined,
  admin: { from: (t: string) => any },
): Promise<boolean> {
  if (!u?.master_id || !RUOLI_SUPER_MASTER.includes(r(u))) return false
  const { data: m } = await admin.from('masters').select('is_super_master').eq('id', u.master_id).maybeSingle()
  return !!(m as any)?.is_super_master
}

/** Toglie da una riga di spedizione le colonne che dicono il COSTO DEL MASTER: `costo_spedizione` (quanto
 *  paga lui al corriere) e `raw_response`, la risposta del fornitore, che contiene lo stesso prezzo
 *  (shipmentCost, totalPrice, importo). Va applicata a tutto cio' che esce verso chi NON gestisce la rete:
 *  l'agente ha come costo solo il suo listino agente, il cliente nessuno. Nessuna pagina le legge — ma
 *  finivano nel browser, e bastava aprire gli strumenti per sviluppatori. */
export function senzaCostoMaster<T>(riga: T): T {
  if (!riga || typeof riga !== 'object') return riga
  const { costo_spedizione: _costo, raw_response: _fornitore, ...resto } = riga as any
  return resto as T
}
