// CHI PUO' STARE DENTRO UN TICKET.
//
// Stava dentro app/api/assistenza/[id]/route.ts, ma ora serve anche a /api/file per decidere se
// una persona puo' scaricare l'allegato o la POD di quella richiesta. Una regola di accesso
// copiata in due punti prima o poi diverge, e la copia dimenticata diventa il buco: sta qui, una
// volta sola.

export type RuoloTicket = 'master' | 'cliente' | 'rete'

// 'master' = lato assistenza (owner che risponde), 'cliente' = lato richiedente (il cliente che ha
// aperto, o il master che ha aperto verso la linea superiore), 'rete' = master della catena a cui
// la richiesta e' stata inoltrata. null = non e' parte del ticket (non autorizzato).
export function partecipanteTicket(utente: any, ticket: any): RuoloTicket | null {
  if (!utente) return null
  const ruolo = String(utente.ruolo || '').toLowerCase()
  // UTENTE DEL PORTALE CLIENTE: può stare SOLO sul proprio ticket, mai su altro.
  // Anche il cliente ha un master_id (il master a cui appartiene) e coincide con
  // l'owner_master_id del ticket: senza questa uscita anticipata, aprendo il ticket di un ALTRO
  // cliente dello stesso master si cadeva nel ramo "master" più sotto e lo si leggeva tutto,
  // messaggi interni di rete compresi, potendo anche scrivere firmandosi come assistenza.
  if (ruolo === 'cliente' || utente.cliente_id) {
    return utente.cliente_id && utente.cliente_id === ticket.cliente_id ? 'cliente' : null
  }
  // AGENTE: sola lettura sui SUOI clienti e nessun dato del master o della rete (lib/agente.ts).
  // Qui non c'è modo di limitarlo al suo perimetro (i ticket non hanno un agente), quindi resta
  // fuori: prima era indistinguibile dal master e vedeva le conversazioni di tutti i clienti.
  if (ruolo === 'agente') return null
  if (utente.master_id && utente.master_id === ticket.aperto_master_id) return 'cliente'  // master che ha aperto (richiedente)
  if (utente.master_id && utente.master_id === ticket.owner_master_id) return 'master'    // lato che risponde
  // Master della CATENA a cui il ticket e' stato inoltrato: vede tutto, il cliente non lo vede.
  if (utente.master_id && Array.isArray(ticket.rete_master_ids) && ticket.rete_master_ids.includes(utente.master_id)) return 'rete'
  return null
}

// ── CATENA A PIU' LIVELLI: chi vede fin dove ─────────────────────────────────────────────────────
//
// L'inoltro e' lineare: sotto-master → master → super-master. La catena, dal basso verso l'alto, e'
// [owner, ...rete_master_ids] nell'ordine in cui e' stata inoltrata. Ognuno deve vedere la catena
// COME SE si fermasse a lui piu' un gradino sopra (il master a cui HA inoltrato), MAI oltre: se un
// sotto-master di Velox inoltra a Velox e Velox inoltra a Multi, il sotto-master non deve sapere che
// Multi e' coinvolto. Prima l'owner vedeva TUTTI i messaggi 'rete' e la traccia "inoltrato a Multi".

// La catena completa dal basso: owner (posizione 0), poi i master di rete (posizioni 1, 2, ...).
export function catenaTicket(ticket: any): string[] {
  const rete = Array.isArray(ticket?.rete_master_ids) ? ticket.rete_master_ids : []
  return [ticket?.owner_master_id, ...rete].filter(Boolean)
}

// Posizione di un master nella catena (owner=0, rete[k]=k+1); -1 se non ne fa parte.
export function posizioneCatena(masterId: string | null | undefined, ticket: any): number {
  if (!masterId) return -1
  return catenaTicket(ticket).indexOf(masterId)
}

// Un messaggio 'rete' e' visibile a chi guarda (posizione p nella catena) solo se il suo autore sta
// alla posizione p o piu' in basso, oppure UN gradino sopra (p+1 = il proprio bersaglio d'inoltro,
// di cui devo vedere le risposte). Oltre p+1 = non lo vedo. I messaggi 'pubblico' li vedono tutti.
export function messaggioVisibileCatena(msg: any, posViewer: number, ticket: any): boolean {
  if (msg?.visibilita !== 'rete') return true
  const a = posizioneCatena(msg?.autore_master_id, ticket)
  if (a < 0) return true                 // autore fuori catena (legacy senza master_id): fallback, mostra
  return a <= posViewer + 1
}

// Nasconde, nel ticket restituito a un master, la parte di catena OLTRE il suo bersaglio d'inoltro:
// rete_master_ids fino a rete[posViewer], inoltrato_a = ultimo visibile, rete_non_letti filtrato.
export function mascheraCatena(ticket: any, viewerMasterId: string | null | undefined): any {
  const p = posizioneCatena(viewerMasterId, ticket)
  if (p < 0) return ticket               // non e' un master della catena: lascio decidere al chiamante
  const rete: string[] = Array.isArray(ticket?.rete_master_ids) ? ticket.rete_master_ids : []
  const reteVis = rete.slice(0, p + 1)   // le voci fino al proprio bersaglio (chain pos <= p+1)
  const nonLetti = Array.isArray(ticket?.rete_non_letti) ? ticket.rete_non_letti.filter((x: string) => reteVis.includes(x)) : ticket?.rete_non_letti
  return {
    ...ticket,
    rete_master_ids: reteVis,
    inoltrato_a_master_id: reteVis.length ? reteVis[reteVis.length - 1] : null,
    rete_non_letti: nonLetti,
  }
}

// "Chi se ne occupa" PER MASTER: ogni livello della catena ha la sua assegnazione, indipendente e
// invisibile agli altri (in `tickets.assegnazioni` = { "<master_id>": {id, nome} }). Restituisce
// l'assegnazione DEL MASTER che guarda — così un livello non vede mai chi ha in carico un altro.
export function assegnatoPer(ticket: any, masterId: string | null | undefined): { assegnato_id: string | null; assegnato_nome: string | null } {
  const mappa = ticket?.assegnazioni
  const voce = masterId && mappa && typeof mappa === 'object' ? mappa[masterId] : null
  return { assegnato_id: voce?.id || null, assegnato_nome: voce?.nome || null }
}
