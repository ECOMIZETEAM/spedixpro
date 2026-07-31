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
