// TROVARE LA COPIA DI UN CONTRATTO PRESSO UN ALTRO MASTER.
//
// Ogni master ha una PROPRIA riga in `corrieri` per lo stesso contratto reale, e il legame fra
// padre e figlio e' il NOME. Il confronto va quindi fatto SEMPRE allo stesso modo, altrimenti due
// parti del sistema si trovano in disaccordo su cosa sia "lo stesso contratto".
//
// E' successo davvero: la sospensione lungo la catena normalizza il nome (minuscolo + spazi tolti,
// lib/contratti-catena.ts) e anche la propagazione dei listini (lib/copia-listino-submaster.ts),
// mentre il calcolo del costo a cascata cercava con uguaglianza esatta. In produzione c'e' un
// contratto salvato come 'SDA ' (con lo spazio finale) sotto Ecomize e come 'SDA' sotto
// MULTIEXPRESS: per la sospensione erano lo stesso contratto, per la cascata no. Effetto: il
// detentore vero del contratto non veniva riconosciuto, quindi non veniva addebitato e il suo
// credito non veniva nemmeno controllato. Un buco silenzioso, e nella direzione che costa soldi.
//
// Qui il confronto e' uno solo, e vale da entrambi i lati: si normalizza il nome cercato E quello
// salvato.

export function nomeContrattoNormalizzato(v: string | null | undefined): string {
  return String(v || '').trim().toLowerCase()
}

// DUE RIGHE CON LO STESSO NOME (26/11/2026). Fino a ieri un master aveva una riga per nome, e trovarla per nome
// bastava. Da quando un master puo' STACCARSI da un fornitore e ricomprare lo stesso contratto da un altro
// (scripts/stacca-contratto.sql), ne puo' avere due: quella staccata, che resta per i pacchi gia' partiti, e quella
// nuova. La scelta allora dipende da cosa si sta facendo:
//   - una spedizione NUOVA usa la riga attiva: fra le omonime vince quella non staccata, poi la piu' vecchia,
//     sempre la stessa (prima la query non aveva ordine: vinceva quella che il database restituiva per prima);
//   - un evento su un pacco GIA' PARTITO (reso, giacenza, rettifica) usa la riga della SUA catena, letta dai
//     puntatori a partire dalla riga della spedizione (`corrierePacco`): la catena di allora, mai il fornitore
//     di oggi. Per nome si ripiega solo se quel master non sta sulla catena del pacco, o se la catena non si legge:
//     allora, fra due omonime, vale quella che era in vita il giorno della partenza (`partenza`): nata prima e non
//     ancora staccata. Una riga staccata non riceve spedizioni dal momento dello stacco, e una sola alla volta è viva
//     (scripts/stacca-contratto-vincolo.sql): la data dice da sola su quale il pacco è partito.
export type OpzioniRiga = { corrierePacco?: string | null; partenza?: string | null }

type RigaOmonima = { id: string; staccato_il?: string | null; created_at?: string | null }
export function ordinaOmonime<T extends RigaOmonima>(righe: T[]): T[] {
  return [...righe].sort((a, b) =>
    (a.staccato_il ? 1 : 0) - (b.staccato_il ? 1 : 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// La catena dei fornitori di un pacco, dalla riga della spedizione in su (RPC catena_contratto): master → la sua
// riga. Tenuta mezzo minuto: la catena di un pacco gia' partito non cambia, e un evento la chiede una volta per
// livello. Una lettura fallita si riprova una volta e NON si tiene in memoria (la chiamata dopo ritenta); se fallisce
// ancora, `letta: false` e chi chiama sceglie per data di partenza (vedi sopra), scrivendolo nel log.
type Fila = { letta: boolean; righe: Map<string, { id: string; nome: string }> }
const cacheFile = new Map<string, { at: number; fila: Promise<Fila> }>()
async function leggiFila(adminDb: any, corriereId: string): Promise<Fila> {
  for (let tentativo = 1; tentativo <= 2; tentativo++) {
    const { data, error } = await adminDb.rpc('catena_contratto', { p_corriere_id: corriereId })
    if (!error && !data?.length) return { letta: true, righe: new Map() }
    if (!error) {
      const ids = (data as any[]).map(r => r.corriere_id)
      const { data: nomi, error: eN } = await adminDb.from('corrieri').select('id,nome_contratto').in('id', ids)
      if (!eN) {
        const nomeDi = new Map((nomi || []).map((r: any) => [r.id, r.nome_contratto]))
        const righe = new Map<string, { id: string; nome: string }>()
        for (const r of data as any[]) if (!righe.has(r.master_id)) righe.set(r.master_id, { id: r.corriere_id, nome: String(nomeDi.get(r.corriere_id) || '') })
        return { letta: true, righe }
      }
      console.error('[contratto-per-nome] nomi della catena del pacco non leggibili:', corriereId, eN.message, 'tentativo', tentativo)
    } else {
      console.error('[contratto-per-nome] catena del pacco non leggibile:', corriereId, error.message, 'tentativo', tentativo)
    }
  }
  return { letta: false, righe: new Map() }
}
async function righeDellaFila(adminDb: any, corriereId: string): Promise<Fila> {
  const c = cacheFile.get(corriereId)
  if (c && Date.now() - c.at < 30_000) return c.fila
  const fila = leggiFila(adminDb, corriereId)
  cacheFile.set(corriereId, { at: Date.now(), fila })
  fila.then(f => { if (!f.letta) cacheFile.delete(corriereId) }, () => cacheFile.delete(corriereId))
  if (cacheFile.size > 500) for (const k of Array.from(cacheFile.keys()).slice(0, 250)) cacheFile.delete(k)
  return fila
}

// Fra righe omonime dello stesso master, quella in vita al momento della partenza: nata prima, non ancora staccata.
// Null se nessuna (o piu' d'una) torna: allora decide l'ordine di sempre.
function vivaAllaPartenza<T extends RigaOmonima>(righe: T[], partenza: string | null | undefined): T | null {
  const t = partenza ? new Date(partenza).getTime() : NaN
  if (!Number.isFinite(t)) return null
  const vive = righe.filter(r => {
    const nata = r.created_at ? new Date(r.created_at).getTime() : -Infinity
    const staccata = r.staccato_il ? new Date(r.staccato_il).getTime() : Infinity
    return nata <= t && t < staccata
  })
  return vive.length === 1 ? vive[0] : null
}

// Id della riga `corrieri` di quel master per quel nome contratto, oppure null.
// `adminDb` deve essere il client amministrativo: si leggono righe di master diversi dal chiamante.
// `opz.corrierePacco`: la riga della spedizione, per gli eventi dopo la partenza (vedi sopra).
export async function corriereDiMasterPerNome(
  adminDb: any, masterId: string | null | undefined, nomeContratto: string | null | undefined, opz?: OpzioniRiga,
): Promise<string | null> {
  const cercato = nomeContrattoNormalizzato(nomeContratto)
  if (!masterId || !cercato) return null
  let filaLetta = true
  if (opz?.corrierePacco) {
    // Sulla catena del pacco, e con lo stesso nome: se il nome non torna (una rinomina a meta') non si rischia.
    const fila = await righeDellaFila(adminDb, opz.corrierePacco)
    filaLetta = fila.letta
    const diFila = fila.righe.get(masterId)
    if (diFila && nomeContrattoNormalizzato(diFila.nome) === cercato) return diFila.id
  }
  const { data } = await adminDb.from('corrieri').select('id,nome_contratto,staccato_il,created_at').eq('master_id', masterId)
  const omonime = ordinaOmonime(((data || []) as any[]).filter(c => nomeContrattoNormalizzato(c.nome_contratto) === cercato))
  // Due omonime (una staccata) e un pacco gia' partito: per nome vincerebbe la viva, cioe' il fornitore di OGGI.
  // Vale invece quella in vita alla partenza. Se nemmeno la data decide, lo si scrive: e' un addebito da guardare.
  if (omonime.length > 1 && opz?.corrierePacco) {
    const allora = vivaAllaPartenza(omonime, opz.partenza)
    if (allora) return allora.id
    console.error('[STACCA] riga del pacco non determinabile, uso la viva:', masterId, cercato, 'pacco su', opz.corrierePacco,
      filaLetta ? '(master fuori dalla fila)' : '(fila non leggibile)', 'partenza', opz.partenza ?? 'ignota')
  }
  return omonime[0]?.id ?? null
}

// DETENTORE di un contratto: chi lo ha col corriere, e quindi chi riceve dal corriere i soldi
// (contrassegni compresi) e ne paga il costo reale.
//
// Si parte dal master che possiede la copia usata dalla spedizione e si sale finché il padre ha lo
// stesso contratto. Il detentore però SI DICHIARA: se una copia lungo la strada è marcata `proprio`,
// la salita si ferma lì — un contratto con lo stesso nome più in alto non se lo può prendere.
//
// Sta qui, e non dentro chi la usa, perché decide chi paga cosa: il costo a cascata (lib/cascata.ts),
// l'anticipo dei contrassegni lungo la rete e il colore del contrassegno a ogni livello devono vedere
// lo STESSO detentore.
//
// La salita ha DUE sorgenti, non due copie: una interroga il database un livello alla volta (una
// spedizione sola), l'altra legge un indice già caricato (una lista intera: con le query per livello
// una pagina da 50 righe farebbe decine di viaggi, 75-330 ms l'uno).
export type SorgenteCatena = {
  padreDi: (masterId: string) => Promise<string | null> | string | null
  copiaDi: (masterId: string, nomeContratto: string) => Promise<{ proprio: boolean } | null> | { proprio: boolean } | null
  // Solo la sorgente in memoria: se qualche master ha una riga STACCATA con questo nome. Allora, per un pacco, la
  // copia "per nome" puo' non essere quella con cui e' partito, e va chiesta al database con la riga del pacco.
  haStaccate?: (nomeContratto: string) => boolean
}

export async function detentoreContrattoCon(
  sorgente: SorgenteCatena, corriereOwnerId: string, nomeContratto: string | null | undefined
): Promise<{ detentore: string; dichiaratoProprio: boolean }> {
  let detentore = corriereOwnerId
  let dichiaratoProprio = false
  if (!nomeContratto) return { detentore, dichiaratoProprio }
  let cur: string | null = corriereOwnerId
  for (let i = 0; i < 20 && cur; i++) {
    const mia = await sorgente.copiaDi(cur, nomeContratto)
    if (mia?.proprio) { detentore = cur; dichiaratoProprio = true; break }
    const parent: string | null = await sorgente.padreDi(cur)
    if (!parent) break
    // Confronto NORMALIZZATO (vedi in cima al file): con l'uguaglianza esatta un nome salvato con uno
    // spazio finale su un livello e senza sull'altro faceva perdere il detentore vero.
    const delPadre = await sorgente.copiaDi(parent, nomeContratto)
    if (delPadre) { detentore = parent; cur = parent } else break
  }
  return { detentore, dichiaratoProprio }
}

// Sorgente "una riga alla volta": per una spedizione sola (es. la guardia dell'anticipo).
export function sorgenteDaDatabase(adminDb: any, opz?: OpzioniRiga): SorgenteCatena {
  return {
    padreDi: async (id) => {
      const { data }: any = await adminDb.from('masters').select('parent_master_id').eq('id', id).maybeSingle()
      return data?.parent_master_id || null
    },
    copiaDi: async (id, nome) => {
      const cid = await corriereDiMasterPerNome(adminDb, id, nome, opz)
      if (!cid) return null
      const { data }: any = await adminDb.from('corrieri').select('proprio').eq('id', cid).maybeSingle()
      return { proprio: !!data?.proprio }
    },
  }
}

export async function detentoreContratto(
  adminDb: any, corriereOwnerId: string, nomeContratto: string | null | undefined, opz?: OpzioniRiga,
): Promise<{ detentore: string; dichiaratoProprio: boolean }> {
  return detentoreContrattoCon(sorgenteDaDatabase(adminDb, opz), corriereOwnerId, nomeContratto)
}

// Sorgente "tutto in memoria": due letture (masters + corrieri) e poi nessun altro viaggio.
// Si leggono TUTTI i corrieri, non solo quelli dei nomi che servono: i nomi vanno confrontati
// normalizzati, e un filtro per nome esatto perderebbe proprio la copia scritta in modo diverso.
//
// TENUTA IN CALDO PER UN MINUTO. Le due letture costavano 229 ms a OGNI apertura dell'elenco
// spedizioni (misurato il 25/09 su MULTIEXPRESS: un quarto del tempo della pagina), e i master e i
// contratti cambiano qualche volta al giorno, non a ogni clic. Il prezzo del ritardo e' che un
// contratto appena creato entra nei colori dei contrassegni entro un minuto: nessun conto ne dipende
// — chi decide i SOLDI (cascata, anticipo) legge sempre dal database, non da qui.
let cacheCatena: { at: number; sorgente: SorgenteCatena } | null = null
export async function caricaSorgenteCatena(adminDb: any): Promise<SorgenteCatena> {
  if (cacheCatena && Date.now() - cacheCatena.at < 60_000) return cacheCatena.sorgente
  const fresca = await costruisciSorgenteCatena(adminDb)
  cacheCatena = { at: Date.now(), sorgente: fresca }
  return fresca
}

async function costruisciSorgenteCatena(adminDb: any): Promise<SorgenteCatena> {
  const [mRes, cRes]: any = await Promise.all([
    adminDb.from('masters').select('id,parent_master_id'),
    adminDb.from('corrieri').select('master_id,nome_contratto,proprio,staccato_il'),
  ])
  const padri = new Map<string, string | null>()
  for (const m of (mRes.data || [])) padri.set(m.id, m.parent_master_id || null)
  const copie = new Map<string, { proprio: boolean; staccata?: boolean }>()
  const nomiStaccati = new Set<string>()
  for (const c of (cRes.data || [])) {
    if (c.staccato_il) nomiStaccati.add(nomeContrattoNormalizzato(c.nome_contratto))
    const k = c.master_id + '|' + nomeContrattoNormalizzato(c.nome_contratto)
    // Fra due copie collo stesso nome vince quella dichiarata propria: è la dichiarazione che conta. Poi quella
    // non staccata (26/11/2026): una riga staccata resta solo per i pacchi gia' partiti.
    const gia = copie.get(k)
    if (!gia || (!gia.proprio && (c.proprio || (gia.staccata && !c.staccato_il)))) copie.set(k, { proprio: !!c.proprio, staccata: !!c.staccato_il })
  }
  return {
    padreDi: (id) => padri.get(id) ?? null,
    copiaDi: (id, nome) => copie.get(id + '|' + nomeContrattoNormalizzato(nome)) || null,
    haStaccate: (nome) => nomiStaccati.has(nomeContrattoNormalizzato(nome)),
  }
}
