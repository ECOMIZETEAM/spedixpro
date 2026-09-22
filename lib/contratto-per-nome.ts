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
// Sta qui, e non dentro chi la usa, perché decide chi paga cosa: il costo a cascata (lib/cascata.ts)
// e l'anticipo dei contrassegni lungo la rete devono vedere lo STESSO detentore.
export async function detentoreContratto(
  adminDb: any, corriereOwnerId: string, nomeContratto: string | null | undefined
): Promise<{ detentore: string; dichiaratoProprio: boolean }> {
  let detentore = corriereOwnerId
  let dichiaratoProprio = false
  if (!nomeContratto) return { detentore, dichiaratoProprio }
  let cur: string | null = corriereOwnerId
  for (let i = 0; i < 20 && cur; i++) {
    const cid = await corriereDiMasterPerNome(adminDb, cur, nomeContratto)
    if (cid) {
      const { data: cc }: any = await adminDb.from('corrieri').select('proprio').eq('id', cid).maybeSingle()
      if (cc?.proprio) { detentore = cur; dichiaratoProprio = true; break }
    }
    const { data: mm }: any = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    const parent: string | null = mm?.parent_master_id || null
    if (!parent) break
    // Confronto NORMALIZZATO: con l'uguaglianza esatta un nome salvato con uno spazio finale su un
    // livello e senza sull'altro faceva perdere il detentore vero (vedi in cima al file).
    const pcId = await corriereDiMasterPerNome(adminDb, parent, nomeContratto)
    if (pcId) { detentore = parent; cur = parent } else break
  }
  return { detentore, dichiaratoProprio }
}
