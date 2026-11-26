// ZONE LUNGO LA CATENA D'ACQUISTO (26/11/2026). Le zone di un contratto COMPRATO sono quelle del suo fornitore, e
// le tiene uguali il DATABASE (scripts/zone-catena-trigger.sql): quando il venditore cambia un CAP, una zona, un
// nome, i trigger portano la modifica a ogni contratto che lo compra, livello per livello. Il codice non scrive più
// zone nelle copie: le legge e le abbina per chiave, per copiare i PREZZI.

// La chiave di una zona, la stessa dell'indice zone_una_per_chiave: nome senza spazi ai lati (solo spazi, come
// btrim) e in minuscole, multicollo, partenza. Il nome da solo non basta: una zona multicollo può chiamarsi come
// quella del collo singolo, e abbinarle per nome rimescolava zone singole e multicollo.
export function chiaveZona(z: { nome?: string | null; multicollo?: boolean | null; su_mittente?: boolean | null }): string {
  return `${String(z.nome ?? '').replace(/^ +| +$/g, '').toLowerCase()}|${z.multicollo ? 1 : 0}|${z.su_mittente ? 1 : 0}`
}

type ZonaChiave = { id: string; nome?: string | null; multicollo?: boolean | null; su_mittente?: boolean | null; corriere_id?: string | null }

// Abbina le zone del fornitore a quelle di chi compra. `contrattoDi` dice in quale contratto di chi compra cercare
// la copia di una zona del fornitore (undefined = quel contratto non gli arriva: si salta). Ritorna l'abbinamento
// e le zone del fornitore che la copia NON ha: con i trigger non dovrebbero essercene, e se ce ne sono chi chiama
// si ferma prima di toccare i prezzi (una fascia senza zona andrebbe persa).
export function abbinaZone(
  delFornitore: ZonaChiave[],
  diChiCompra: ZonaChiave[],
  contrattoDi: (z: ZonaChiave) => string | undefined,
): { mappa: Map<string, string>; mancanti: string[] } {
  const mie = new Map<string, string>()
  for (const z of diChiCompra) mie.set(`${z.corriere_id}|${chiaveZona(z)}`, z.id)
  const mappa = new Map<string, string>()
  const mancanti: string[] = []
  for (const z of delFornitore) {
    const contratto = contrattoDi(z)
    if (!contratto) continue
    const mia = mie.get(`${contratto}|${chiaveZona(z)}`)
    if (mia) mappa.set(z.id, mia)
    else mancanti.push(String(z.nome ?? z.id))
  }
  return { mappa, mancanti }
}

// Si possono modificare le zone di questo contratto dal portale? Solo se è PROPRIO (nessun fornitore). Il database
// già non lascia scrivere le altre (policy zone_restr_* e zc_restr_*), ma una UPDATE o una DELETE bloccate così non
// danno errore: toccano zero righe, e il portale rispondeva "fatto" senza aver fatto niente. Ritorna il messaggio da
// mostrare, o null se si può. Con `masterId` il contratto dev'essere di quel master (la lettura è col client di
// servizio: non deve dire niente dei contratti degli altri).
export async function zoneNonModificabili(admin: any, corriereId: string | null | undefined, masterId?: string | null): Promise<string | null> {
  if (!corriereId) return null
  const { data: c, error } = await admin.from('corrieri').select('master_id,nome_contratto,proprio,staccato_il,fornitore_corriere_id').eq('id', corriereId).maybeSingle()
  if (error) return 'Contratto non leggibile in questo momento: riprova tra poco.'
  if (!c || (masterId !== undefined && c.master_id !== masterId)) return 'Contratto non trovato.'
  const nome = String(c.nome_contratto || '').trim()
  if (c.staccato_il) return `«${nome}» è staccato: le sue zone restano quelle di quando i suoi pacchi sono partiti.`
  // "Si aggiornano da sole" è vero solo se c'è un fornitore da cui arrivano (è il puntatore che seguono i trigger).
  if (c.fornitore_corriere_id) return `Le zone di «${nome}» sono quelle del fornitore del contratto: si aggiornano da sole quando le cambia lui, e da qui non si modificano.`
  // Senza fornitore ma non proprio: il database non lascia scrivere (policy zone_restr_*), e nessuno gliele porta.
  if (c.proprio !== true) return `Le zone di «${nome}» non si possono modificare da qui: scrivi all'assistenza.`
  return null
}

// Chi può cambiare le zone: lo staff del master (master, admin, operatore), come le policy del database
// (auth_staff_master). Ritorna il master, o null.
export async function staffDelMaster(supabase: any, userId: string): Promise<string | null> {
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', userId).maybeSingle()
  if (!u?.master_id || !['master', 'admin', 'operatore'].includes(String(u.ruolo || '').toLowerCase())) return null
  return u.master_id
}
