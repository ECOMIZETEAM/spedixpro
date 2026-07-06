// Helper per la "rete": i sotto-master agganciati a un master.
// Un master figlio va trattato come un CLIENTE dal padre (ci guadagna sopra),
// quindi compare nel filtro cliente e se ne possono vedere le spedizioni.

// Master figli DIRETTI di un master (quelli "agganciati").
export async function masterFigliDiretti(adminDb: any, masterId: string): Promise<{ id: string, nome: string }[]> {
  const { data } = await adminDb.from('masters')
    .select('id,nome').eq('parent_master_id', masterId).order('nome', { ascending: true })
  return (data || []).map((m: any) => ({ id: m.id, nome: m.nome || '—' }))
}

// Sotto-albero di un master: [masterId, figli, nipoti, ...] (id). Serve per filtrare
// TUTTE le spedizioni che passano sotto quel master.
export async function sottoAlberoMasterIds(adminDb: any, rootId: string): Promise<string[]> {
  const ids: string[] = [rootId]
  const seen = new Set<string>([rootId])
  let frontier = [rootId]
  for (let i = 0; i < 12 && frontier.length; i++) {
    const { data } = await adminDb.from('masters').select('id,parent_master_id').in('parent_master_id', frontier)
    const nuovi: string[] = []
    for (const m of (data || [])) {
      if (seen.has(m.id)) continue
      seen.add(m.id); ids.push(m.id); nuovi.push(m.id)
    }
    frontier = nuovi
  }
  return ids
}
