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

// Id della riga `corrieri` di quel master per quel nome contratto, oppure null.
// `adminDb` deve essere il client amministrativo: si leggono righe di master diversi dal chiamante.
export async function corriereDiMasterPerNome(
  adminDb: any, masterId: string | null | undefined, nomeContratto: string | null | undefined
): Promise<string | null> {
  const cercato = nomeContrattoNormalizzato(nomeContratto)
  if (!masterId || !cercato) return null
  const { data } = await adminDb.from('corrieri').select('id,nome_contratto').eq('master_id', masterId)
  for (const c of (data || [])) {
    if (nomeContrattoNormalizzato((c as any).nome_contratto) === cercato) return (c as any).id
  }
  return null
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
export function sorgenteDaDatabase(adminDb: any): SorgenteCatena {
  return {
    padreDi: async (id) => {
      const { data }: any = await adminDb.from('masters').select('parent_master_id').eq('id', id).maybeSingle()
      return data?.parent_master_id || null
    },
    copiaDi: async (id, nome) => {
      const cid = await corriereDiMasterPerNome(adminDb, id, nome)
      if (!cid) return null
      const { data }: any = await adminDb.from('corrieri').select('proprio').eq('id', cid).maybeSingle()
      return { proprio: !!data?.proprio }
    },
  }
}

export async function detentoreContratto(
  adminDb: any, corriereOwnerId: string, nomeContratto: string | null | undefined
): Promise<{ detentore: string; dichiaratoProprio: boolean }> {
  return detentoreContrattoCon(sorgenteDaDatabase(adminDb), corriereOwnerId, nomeContratto)
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
    adminDb.from('corrieri').select('master_id,nome_contratto,proprio'),
  ])
  const padri = new Map<string, string | null>()
  for (const m of (mRes.data || [])) padri.set(m.id, m.parent_master_id || null)
  const copie = new Map<string, { proprio: boolean }>()
  for (const c of (cRes.data || [])) {
    const k = c.master_id + '|' + nomeContrattoNormalizzato(c.nome_contratto)
    // Fra due copie collo stesso nome vince quella dichiarata propria: è la dichiarazione che conta.
    if (!copie.get(k)?.proprio) copie.set(k, { proprio: !!c.proprio })
  }
  return {
    padreDi: (id) => padri.get(id) ?? null,
    copiaDi: (id, nome) => copie.get(id + '|' + nomeContrattoNormalizzato(nome)) || null,
  }
}
