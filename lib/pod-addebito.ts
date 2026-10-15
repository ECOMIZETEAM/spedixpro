// ADDEBITO DI UNA RICHIESTA POD (prova di consegna).
//
// Decisione del committente (15/10/2026): il cliente vede il costo della POD (dipende dal vettore
// della spedizione), lo accetta e lo paga SUBITO, all'apertura — app/api/assistenza/apri. Prima si
// pagava solo quando l'assistenza caricava il file col tasto "Carica POD", e una POD mandata come
// allegato in chat arrivava gratis (TK-04637, GTS → MDS, 3,30 € mai addebitati).
// Le altre due chiamate — "Carica POD" e un allegato mandato al cliente in chat — restano per le
// richieste aperte prima di quel giorno e come nuovo tentativo se l'addebito all'apertura non e'
// riuscito; su una richiesta gia' pagata non fanno niente. Nei ticket di assistenza la chat resta
// gratuita: il filtro sulla categoria e' nella funzione del database.
//
// La regola vive nel database, funzione addebita_pod (scripts/pod-addebito.sql): segna la richiesta
// e scrive il movimento in una transazione sola, cosi' non si paga mai due volte — nemmeno se la
// risposta del database si perde dopo aver scritto — e non resta mai "addebitata" senza movimento.
// Non blocca mai la richiesta: se fallisce, resta "da addebitare" e si riprova al prossimo invio.
// Ritorna l'importo addebitato ORA (0 se gratuita, gia' pagata o fallita): chi conferma al cliente
// "addebitati X €" deve dirlo solo se e' successo davvero.
export async function addebitaPod(admin: any, ticketId: string, createdBy: string | null): Promise<number> {
  const { data, error } = await admin.rpc('addebita_pod', { p_ticket_id: ticketId, p_created_by: createdBy })
  if (error) {
    console.error('[POD][ADDEBITO] fallito, richiesta POD lasciata da addebitare — ticket', ticketId, error.message)
    return 0
  }
  return Number(data) || 0
}
