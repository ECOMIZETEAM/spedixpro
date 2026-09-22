// A CHI PAGA UN LIVELLO IL CONTRASSEGNO DI UNA SPEDIZIONE.
//
// Il corriere versa i contrassegni al DETENTORE del contratto; da lì i soldi scendono un gradino
// alla volta: il detentore paga il sotto-master sotto di lui, quello paga il successivo, e l'ultimo
// master paga il suo cliente. Ogni livello paga SOLO chi gli sta direttamente sotto.
//
// La stessa regola serve in due porte: il caricamento del file del corriere (upload-cod) e l'anticipo
// fatto a mano da Lista contrassegni, quando un livello paga quello sotto prima che arrivi il file.
// Deve dare la stessa risposta in entrambe, altrimenti il file del corriere non riconosce l'anticipo
// e lo stesso contrassegno si paga due volte.

// Risale la catena dei master: [masterId, padre, nonno, ...]
export async function risaliCatena(adminDb: any, masterId: string): Promise<string[]> {
  const path: string[] = []
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    path.push(cur)
    const { data: m }: any = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = m?.parent_master_id || null
  }
  return path
}

export type DestinatarioCod =
  | { fuori: true }                                               // la spedizione non è nella mia rete
  | { fuori: false; cliente_id: string | null; target_master_id: string | null }
// cliente_id e target_master_id entrambi null = spedizione PROPRIA del master: nessuno da pagare.

// `catena` = risaliCatena(spedizione.master_id). `mio` = il master che paga.
export function destinatarioCod(catena: string[], mio: string, clienteId: string | null): DestinatarioCod {
  const idx = catena.indexOf(mio)
  if (idx === -1) return { fuori: true }
  if (idx === 0) return { fuori: false, cliente_id: clienteId || null, target_master_id: null }
  return { fuori: false, cliente_id: null, target_master_id: catena[idx - 1] }
}
