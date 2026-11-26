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

// ── IL COSTO DI UN MASTER (Listino Corrieri) ───────────────────────────────────────────────────────
//
// Stessa regola, un livello sopra: dopo la partenza il master paga il SUO costo anche se le fasce del suo
// Listino Corrieri sono state cancellate ("Disattiva per sotto-master" del padre, listino svuotato o
// eliminato). Il database le copia in `listini_corrieri_archivio` (scripts/archivio-prezzi-costo-master.sql).
// Prima il reso del master ripiegava su quanto aveva pagato all'andata, contrassegno compreso, e la
// rettifica sul listino del padre o si fermava "non calcolabile".
//
// L'unita' qui e' la RIGA DEL CONTRATTO, non la coppia listino × contratto: il costo di un master si legge
// da tutte le fasce della sua riga, in qualunque suo listino stiano (calcolaPrezzoCorriereDettaglio), e le
// fasce stanno sempre sulla riga dello stesso master del listino.

export type ArchivioCosto = { fasce: any[]; supplementi: any[]; agganci: any[] }

// Il contratto ha ancora fasce di costo? Se si', il costo si legge da li', come sempre.
export async function haFasceCostoVive(db: any, corriereId: string): Promise<boolean> {
  const { data, error } = await db.from('listini_corrieri_fasce').select('id').eq('corriere_id', corriereId).limit(1)
  // Lettura fallita = "ci sono": l'archivio non deve prendere il posto di prezzi che ci sono.
  if (error) return true
  return (data || []).length > 0
}

// Se e solo se il contratto non ha piu' nessuna fascia di costo, le sue righe archiviate. Altrimenti null.
// Col client di SERVIZIO: l'archivio non e' leggibile da nessun utente.
export async function archivioCostoSeTolto(db: any, corriereId: string): Promise<ArchivioCosto | null> {
  if (!corriereId || await haFasceCostoVive(db, corriereId)) return null
  const { data, error } = await db.from('listini_corrieri_archivio').select('tabella,riga').eq('corriere_id', corriereId)
  if (error || !data?.length) return null
  const di = (t: string) => (data as any[]).filter(r => r.tabella === t).map(r => r.riga).sort(perId)
  const fasce = di('listini_corrieri_fasce')
  if (!fasce.length) return null
  return { fasce, supplementi: di('listini_corrieri_supplementi'), agganci: di('listini_corrieri_corrieri') }
}

// Ordine per id come `.order('id')` del database: con righe doppie vince la stessa che vinceva nel listino.
// Confronto semplice e non localeCompare: gli id sono uuid in minuscolo, e il database li confronta byte
// per byte.
export function perId(a: any, b: any): number {
  const x = String(a?.id ?? ''), y = String(b?.id ?? '')
  return x < y ? -1 : x > y ? 1 : 0
}

// Le righe giacenza (apertura e servizi) del Listino Corrieri di un contratto i cui prezzi di costo sono
// stati cancellati, in ordine di id come le legge il listino. null = il contratto ha ancora fasce di
// costo, e le righe si leggono dal listino come sempre. La usano sia il prezzo ADDEBITATO
// (lib/giacenza-cascata.ts) sia quello MOSTRATO nel dettaglio giacenza: devono restare uguali.
export async function giacenzaCostoArchiviata(db: any, corriereId: string): Promise<any[] | null> {
  const arch = await archivioCostoSeTolto(db, corriereId)
  return arch ? arch.supplementi.filter((s: any) => s.tipo === 'giacenza' || s.tipo === 'giacenza_apertura') : null
}
