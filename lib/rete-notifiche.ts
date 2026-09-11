// DESTINATARI DI RETE per le notifiche broadcast: dato il master MITTENTE, l'insieme dei master a
// valle a cui recapitare la notifica. Chi la legge dentro quei master è lo STAFF (master/admin/
// operatore), NON i loro clienti (scelta di prodotto: è un messaggio da master a master).
//
//   'diretti'   → solo i sotto-master DIRETTI (parent_master_id = mio)
//   'tutti'     → TUTTA la rete a valle (discesa ricorsiva: sotto-master, sotto-master dei
//                 sotto-master, ecc.)
//   'contratto' → fra tutta la rete a valle, SOLO chi ha un contratto PROPRIO (corrieri.proprio=true):
//                 i "detentori di contratto".
//
// Usa il client admin: la discesa nella rete e i corrieri dei sotto-master non sono leggibili col
// token del mittente (l'RLS li nasconderebbe). Il mittente NON è mai incluso.
export type ModoRete = 'diretti' | 'tutti' | 'contratto'

export async function masterDestinatariRete(admin: any, mittenteId: string, modo: ModoRete): Promise<string[]> {
  if (!mittenteId) return []

  // 1) Sotto-master DIRETTI.
  if (modo === 'diretti') {
    const { data } = await admin.from('masters').select('id').eq('parent_master_id', mittenteId)
    return (data || []).map((m: any) => m.id)
  }

  // 2) Tutta la rete a valle (BFS, max 12 livelli come le altre camminate della rete).
  const tutti = new Set<string>()
  let frontiera = [mittenteId]
  for (let i = 0; i < 12 && frontiera.length; i++) {
    const { data: figli } = await admin.from('masters').select('id,parent_master_id').in('parent_master_id', frontiera)
    const nuovi: string[] = []
    for (const c of (figli || [])) {
      if (tutti.has(c.id) || c.id === mittenteId) continue
      tutti.add(c.id); nuovi.push(c.id)
    }
    frontiera = nuovi
  }
  const ids = Array.from(tutti)
  if (modo === 'tutti' || !ids.length) return ids

  // 3) Solo i DETENTORI DI CONTRATTO PROPRIO fra i discendenti.
  const conContratto = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data: cs } = await admin.from('corrieri').select('master_id').in('master_id', chunk).eq('proprio', true)
    for (const c of (cs || [])) conContratto.add(c.master_id)
  }
  return Array.from(conContratto)
}
