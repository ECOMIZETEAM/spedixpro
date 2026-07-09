// Helper per la "rete": i sotto-master agganciati a un master.
// Un master figlio va trattato come un CLIENTE dal padre (ci guadagna sopra),
// quindi compare nel filtro cliente e se ne possono vedere le spedizioni.

// Master figli DIRETTI di un master (quelli "agganciati").
export async function masterFigliDiretti(adminDb: any, masterId: string): Promise<{ id: string, nome: string }[]> {
  const { data } = await adminDb.from('masters')
    .select('id,nome').eq('parent_master_id', masterId).order('nome', { ascending: true })
  return (data || []).map((m: any) => ({ id: m.id, nome: m.nome || '—' }))
}

// Master che possono VEDERE tutta la propria rete (sotto-albero completo):
// il root/super-master e chi ha il flag vede_rete_completa. Gli altri master hanno
// una "rete privata": vedono SOLO i propri dati diretti e NON entrano nei
// clienti/sotto-master dei loro figli (la fatturazione a cascata resta separata).
export async function masterVedeReteCompleta(adminDb: any, masterId: string): Promise<boolean> {
  if (!masterId) return false
  const { data: m } = await adminDb.from('masters')
    .select('vede_rete_completa,is_super_master,parent_master_id').eq('id', masterId).maybeSingle()
  if (!m) return false
  return !!(m.vede_rete_completa || m.is_super_master || m.parent_master_id === null)
}

// Master IDs di cui un master vede la VOLUMETRIA (spedizioni/ritiri/contrassegni/giacenze/
// distinte/report/contatori): SEMPRE tutto il proprio sotto-albero. Il giro d'affari della
// rete sotto un master è suo e risale a lui a tutti i livelli.
// La "rete privata" (flag vede_rete_completa) NON limita questi numeri: limita solo l'ACCESSO
// GESTIONALE ai figli (impersona, gestione della loro rete/gerarchia).
export async function masterIdsVisibili(adminDb: any, masterId: string): Promise<string[]> {
  return sottoAlberoMasterIds(adminDb, masterId)
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
