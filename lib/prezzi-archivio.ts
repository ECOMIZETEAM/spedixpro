// I PREZZI DI UN CONTRATTO TOLTO, PER CIO' CHE SUCCEDE DOPO LA PARTENZA.
//
// Regola di Lorenzo (25/11/2026), che sostituisce quella del 18/09: dopo la partenza SI PAGA SEMPRE.
// Reso, giacenza, rettifica di un pacco gia' partito si addebitano anche se nel frattempo il master ha
// tolto il contratto dal listino del cliente, ha spostato il cliente su un altro listino, o il padre ha
// cancellato i prezzi di costo del master. Prima al cliente usciva 0 e la differenza restava al master;
// al master la rettifica si fermava "non calcolabile" e il reso ripiegava sull'andata pagata.
//
// Da dove vengono i prezzi. Quando un contratto esce da un listino, il database copia da solo le righe
// cancellate in `listini_clienti_archivio` (scripts/archivio-prezzi-clienti.sql) e, per i prezzi di costo
// dei master, in `listini_corrieri_archivio` (scripts/archivio-prezzi-costo-master.sql). Nessuna porta di
// VENDITA legge quelle tabelle: le legge SOLO questo file, e il motore dei prezzi usa le righe archiviate
// soltanto quando chi lo chiama gliele passa.
//
// QUI E SOLO QUI si decide da quale listino e da quali righe si prezza un evento dopo la partenza.
// Prima la decisione stava in cinque file, ognuno col suo ordine: il riquadro della giacenza mostrava la
// percentuale di un listino applicata al nolo di un altro, e l'archivio del listino di oggi passava davanti
// al listino con cui il pacco era stato venduto (revisione del 26/11).
//
// Le regole:
//  1. prima i prezzi VIVI: del listino che il cliente ha oggi, poi di quello con cui il pacco e' partito;
//  2. poi l'ARCHIVIO del listino di partenza (di quello di oggi solo se la partenza non e' nota: i pacchi
//     nati prima del 25/11 non se la sono segnata);
//  3. l'archivio vale solo se quei prezzi sono stati tolti DOPO la partenza del pacco: erano quelli in
//     vigore quando e' partito. Tolti prima, il pacco e' stato prezzato da un'altra parte e quei prezzi
//     non c'entrano;
//  4. tabella per tabella vince il vivo: se il listino ha ancora supplementi (o l'aggancio) di quel
//     contratto, valgono quelli, come fa il database (fn_reso_perc_cliente, fn_reso_perc_master);
//  5. una lettura FALLITA non e' "niente in archivio" ne' "niente di vivo": si lancia l'errore e l'evento
//     si ritenta. Uno zero scritto per una lettura andata storta non si ritenta piu' (l'indice unico dei
//     resi lo vieta per sempre).

export type ArchivioCoppia = {
  fasce: any[]
  supplementi: any[] | null   // null = il listino ha ancora supplementi vivi del contratto: valgono quelli
  aggancio: any | null
}
export type FonteCliente = { listinoId: string; archivio: ArchivioCoppia | null }

const errore = (cosa: string, e: any) => new Error(`prezzi dopo la partenza: ${cosa} non leggibile (${e?.message || e})`)

// Ordine per id come `.order('id')` del database: con righe doppie vince la stessa che vinceva nel listino.
// Confronto semplice e non localeCompare: gli id sono uuid in minuscolo, e il database li confronta byte
// per byte.
export function perId(a: any, b: any): number {
  const x = String(a?.id ?? ''), y = String(b?.id ?? '')
  return x < y ? -1 : x > y ? 1 : 0
}

async function esiste(q: any, cosa: string): Promise<boolean> {
  const { data, error } = await q.limit(1)
  if (error) throw errore(cosa, error)
  return (data || []).length > 0
}

// Il listino ha ancora fasce di quel contratto? Se si', il prezzo si legge da li', come sempre.
export async function haFasceVive(db: any, listinoId: string, corriereId: string): Promise<boolean> {
  return esiste(db.from('listini_clienti_fasce').select('id').eq('listino_id', listinoId).eq('corriere_id', corriereId), 'fasce del listino')
}

// Quando e' partito il pacco. null = non si sa, e allora l'archivio non si usa (regola 3).
export async function partenzaDi(db: any, sped: any): Promise<string | null> {
  if (sped?.created_at) return sped.created_at
  if (!sped?.id) return null
  const { data, error } = await db.from('spedizioni').select('created_at').eq('id', sped.id).maybeSingle()
  if (error) throw errore('data della spedizione', error)
  return (data as any)?.created_at || null
}

// Il listino con cui il pacco e' partito. Lo segna il database alla nascita (dal 25/11/2026): i pacchi
// piu' vecchi non ce l'hanno (null).
export async function listinoDiPartenza(db: any, sped: any): Promise<string | null> {
  if (sped?.listino_cliente_id !== undefined) return sped.listino_cliente_id || null
  if (!sped?.id) return null
  const { data, error } = await db.from('spedizioni').select('listino_cliente_id').eq('id', sped.id).maybeSingle()
  if (error) throw errore('listino di partenza', error)
  return (data as any)?.listino_cliente_id || null
}

// Le righe archiviate della coppia, se valgono per un pacco partito il `partenza` (regola 3). null se
// l'archivio non ha fasce o se i prezzi sono stati tolti prima che il pacco partisse.
// Va chiamata col client di SERVIZIO: l'archivio non e' leggibile da nessun utente.
async function archivioCoppiaPerPacco(db: any, listinoId: string, corriereId: string, partenza: string | null): Promise<ArchivioCoppia | null> {
  if (!partenza) return null
  const { data, error } = await db.from('listini_clienti_archivio').select('tabella,riga,archiviato_at')
    .eq('listino_id', listinoId).eq('corriere_id', corriereId)
  if (error) throw errore('archivio del listino', error)
  const righe = (data || []) as any[]
  const fasceR = righe.filter(r => r.tabella === 'listini_clienti_fasce')
  if (!fasceR.length) return null
  // Le fasce di una coppia si archiviano con una cancellazione sola: la piu' vecchia dice quando.
  const tolte = fasceR.map(r => Date.parse(r.archiviato_at)).reduce((a, b) => Math.min(a, b))
  if (!(tolte >= Date.parse(partenza))) return null
  const di = (t: string) => righe.filter(r => r.tabella === t).map(r => r.riga).sort(perId)
  const supplVivi = await esiste(db.from('listini_clienti_supplementi').select('id').eq('listino_id', listinoId).eq('corriere_id', corriereId), 'supplementi del listino')
  return {
    fasce: di('listini_clienti_fasce'),
    supplementi: supplVivi ? null : di('listini_clienti_supplementi'),
    aggancio: di('listini_clienti_corrieri')[0] || null,
  }
}

// LE FONTI DEL PREZZO DEL CLIENTE per un evento dopo la partenza, in ordine (regole 1-3). Chi chiama le
// prova una alla volta e si ferma alla prima che prezza il pacco. Vuota = nessun listino lo prezza piu'.
// `sped` deve avere corriere_id; id (o created_at e listino_cliente_id) per la partenza.
export async function fontiCliente(db: any, sped: any, listinoOggi: string | null | undefined): Promise<FonteCliente[]> {
  const corriereId = sped?.corriere_id
  const out: FonteCliente[] = []
  if (!corriereId) return listinoOggi ? [{ listinoId: listinoOggi, archivio: null }] : out
  const partenza = await listinoDiPartenza(db, sped)
  if (listinoOggi && await haFasceVive(db, listinoOggi, corriereId)) out.push({ listinoId: listinoOggi, archivio: null })
  if (partenza && partenza !== listinoOggi && await haFasceVive(db, partenza, corriereId)) out.push({ listinoId: partenza, archivio: null })
  // L'archivio: del listino di partenza; di quello di oggi solo se la partenza non e' nota.
  const daArchivio = partenza || listinoOggi
  if (daArchivio && !(await haFasceVive(db, daArchivio, corriereId))) {
    const archivio = await archivioCoppiaPerPacco(db, daArchivio, corriereId, await partenzaDi(db, sped))
    if (archivio) out.push({ listinoId: daArchivio, archivio })
  }
  return out
}

// ── IL COSTO DI UN MASTER (Listino Corrieri) ───────────────────────────────────────────────────────
//
// Stessa regola, un livello sopra: dopo la partenza il master paga il SUO costo anche se le fasce del suo
// Listino Corrieri sono state cancellate ("Disattiva per sotto-master" del padre, listino svuotato).
// L'unita' qui e' la RIGA DEL CONTRATTO, non la coppia listino × contratto: il costo di un master si legge
// da tutte le fasce della sua riga, in qualunque suo listino stiano (calcolaPrezzoCorriereDettaglio), e le
// fasce stanno sempre sulla riga dello stesso master del listino.

export type ArchivioCosto = {
  fasce: any[]
  supplementi: any[] | null   // null = il contratto ha ancora supplementi di costo vivi: valgono quelli
  agganci: any[] | null       // null = il contratto ha ancora un aggancio vivo
}

// Il contratto ha ancora fasce di costo? Se si', il costo si legge da li', come sempre.
export async function haFasceCostoVive(db: any, corriereId: string): Promise<boolean> {
  return esiste(db.from('listini_corrieri_fasce').select('id').eq('corriere_id', corriereId), 'fasce di costo')
}

// I prezzi di costo archiviati del contratto, se valgono per un pacco partito il `partenza`. null se il
// contratto ha ancora fasce vive, se l'archivio non ne ha, se sono state tolte prima della partenza
// (regola 3: un livello che ha continuato a spedire senza prezzi di costo, col ripiego sul listino del padre,
// non va prezzato coi prezzi di prima), o se il listino di quelle fasce non c'e' piu': senza la sua riga
// non si sa piu' se valeva "solo peso reale", e un costo sul volume sbagliato e' peggio di nessun costo.
export async function archivioCostoPerPacco(db: any, masterId: string, corriereId: string, partenza: string | null): Promise<ArchivioCosto | null> {
  if (!corriereId || !masterId || !partenza) return null
  if (await haFasceCostoVive(db, corriereId)) return null
  const { data, error } = await db.from('listini_corrieri_archivio').select('tabella,riga,archiviato_at').eq('corriere_id', corriereId)
  if (error) throw errore('archivio dei prezzi di costo', error)
  const righe = (data || []) as any[]
  const fasceR = righe.filter(r => r.tabella === 'listini_corrieri_fasce')
  if (!fasceR.length) return null
  const tolte = fasceR.map(r => Date.parse(r.archiviato_at)).reduce((a, b) => Math.min(a, b))
  if (!(tolte >= Date.parse(partenza))) return null
  const { data: listini, error: eL } = await db.from('listini_corrieri').select('id').eq('master_id', masterId)
  if (eL) throw errore('listini di costo del master', eL)
  const vivi = new Set((listini || []).map((l: any) => l.id))
  if (!fasceR.every(r => vivi.has(r.riga?.listino_id))) return null
  const di = (t: string) => righe.filter(r => r.tabella === t).map(r => r.riga).sort(perId)
  const [supplVivi, agganciVivi] = await Promise.all([
    esiste(db.from('listini_corrieri_supplementi').select('id').eq('corriere_id', corriereId), 'supplementi di costo'),
    esiste(db.from('listini_corrieri_corrieri').select('id').eq('corriere_id', corriereId), 'agganci di costo'),
  ])
  return {
    fasce: di('listini_corrieri_fasce'),
    supplementi: supplVivi ? null : di('listini_corrieri_supplementi'),
    agganci: agganciVivi ? null : di('listini_corrieri_corrieri'),
  }
}

// Le righe giacenza (apertura e servizi) archiviate del Listino Corrieri di un contratto, per quel pacco.
// null = si leggono dal listino come sempre. La usano sia il prezzo ADDEBITATO (lib/giacenza-cascata.ts)
// sia quello MOSTRATO nel dettaglio giacenza: devono restare uguali.
export async function giacenzaCostoArchiviata(db: any, masterId: string, corriereId: string, partenza: string | null): Promise<any[] | null> {
  const arch = await archivioCostoPerPacco(db, masterId, corriereId, partenza)
  return arch?.supplementi ? arch.supplementi.filter((s: any) => s.tipo === 'giacenza' || s.tipo === 'giacenza_apertura') : null
}
