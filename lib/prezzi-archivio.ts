// I PREZZI DI UN CONTRATTO TOLTO DAL LISTINO, PER CIO' CHE SUCCEDE DOPO LA PARTENZA.
//
// Regola di Lorenzo (25/11/2026), che sostituisce quella del 18/09: dopo la partenza SI PAGA SEMPRE.
// Reso, giacenza, rettifica di un pacco gia' partito si addebitano al cliente anche se nel frattempo il
// master gli ha tolto il contratto dal listino, o l'ha spostato su un altro listino. Prima al cliente
// usciva 0 e la differenza restava al master.
//
// Da dove vengono i prezzi. Quando un contratto esce da un listino, il database copia da solo le sue
// fasce, i supplementi e l'aggancio in `listini_clienti_archivio` (scripts/archivio-prezzi-clienti.sql).
// Nessuna porta di VENDITA legge quella tabella: un contratto tolto non puo' tornare in vendita per una
// lettura dimenticata. La leggono solo il motore dei prezzi quando chi chiama dice `dopoPartenza`, e
// solo se il listino non ha piu' NESSUNA fascia di quel contratto.
//
// Quale listino. Prima quello che il cliente ha oggi (come sempre), poi quello con cui il pacco e'
// partito (`spedizioni.listino_cliente_id`, segnato alla nascita dal database dal 25/11/2026). Per
// ognuno: le fasce vive, e se non ci sono quelle archiviate.

export type ArchivioCoppia = { fasce: any[]; supplementi: any[]; aggancio: any | null }

// Il listino ha ancora fasce di quel contratto? Se si', il prezzo si legge da li', come sempre.
export async function haFasceVive(db: any, listinoId: string, corriereId: string): Promise<boolean> {
  const { data, error } = await db.from('listini_clienti_fasce').select('id')
    .eq('listino_id', listinoId).eq('corriere_id', corriereId).limit(1)
  // Una lettura fallita NON vale "tolto": si resta sul listino, come prima. L'archivio e' un ripiego,
  // non deve prendere il posto di prezzi che ci sono solo perche' una lettura e' andata storta.
  if (error) return true
  return (data || []).length > 0
}

// Le righe archiviate della coppia, come erano nel listino. null se l'archivio non ha fasce.
// Va chiamata col client di SERVIZIO: l'archivio non e' leggibile da nessun utente.
export async function archivioCoppia(db: any, listinoId: string, corriereId: string): Promise<ArchivioCoppia | null> {
  const { data, error } = await db.from('listini_clienti_archivio').select('tabella,riga')
    .eq('listino_id', listinoId).eq('corriere_id', corriereId)
  if (error || !data?.length) return null
  const di = (t: string) => (data as any[]).filter(r => r.tabella === t).map(r => r.riga)
  const fasce = di('listini_clienti_fasce')
  if (!fasce.length) return null
  return { fasce, supplementi: di('listini_clienti_supplementi'), aggancio: di('listini_clienti_corrieri')[0] || null }
}

// Se e solo se il listino non prezza piu' il contratto, i suoi prezzi archiviati. Altrimenti null:
// chi chiama legge il listino come ha sempre fatto.
export async function archivioSeTolto(db: any, listinoId: string, corriereId: string): Promise<ArchivioCoppia | null> {
  if (await haFasceVive(db, listinoId, corriereId)) return null
  return archivioCoppia(db, listinoId, corriereId)
}

// Il listino con cui il pacco e' partito. Lo segna il database alla nascita (dal 25/11/2026): i pacchi
// piu' vecchi non ce l'hanno e restano sul listino di oggi, come prima. Una lettura fallita vale
// "non lo so", non un errore: il listino di oggi c'e' comunque.
export async function listinoDiPartenza(db: any, sped: any): Promise<string | null> {
  if (sped?.listino_cliente_id !== undefined) return sped.listino_cliente_id || null
  if (!sped?.id) return null
  const { data, error } = await db.from('spedizioni').select('listino_cliente_id').eq('id', sped.id).maybeSingle()
  return error ? null : ((data as any)?.listino_cliente_id || null)
}

// I listini da provare, in ordine, per un evento dopo la partenza: quello di oggi, poi quello con cui
// il pacco e' partito se e' un altro. Senza doppioni e senza vuoti.
export function listiniDopoPartenza(listinoOggi: string | null | undefined, sped: { listino_cliente_id?: string | null } | null | undefined): string[] {
  const out: string[] = []
  for (const l of [listinoOggi, sped?.listino_cliente_id]) if (l && !out.includes(l)) out.push(l)
  return out
}
