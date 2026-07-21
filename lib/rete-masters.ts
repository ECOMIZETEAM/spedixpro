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
// UNA sola query: la tabella masters è piccola (decine di righe); prima si faceva una query PER
// LIVELLO (fino a 12 round-trip sequenziali ≈ 1s) su OGNI pagina che filtra per rete.
export async function sottoAlberoMasterIds(adminDb: any, rootId: string): Promise<string[]> {
  const { data } = await adminDb.from('masters').select('id,parent_master_id')
  const figliDi = new Map<string, string[]>()
  for (const m of (data || [])) {
    const p = (m as any).parent_master_id
    if (!p) continue
    if (!figliDi.has(p)) figliDi.set(p, [])
    figliDi.get(p)!.push((m as any).id)
  }
  const ids: string[] = [rootId]
  const seen = new Set<string>([rootId])
  let frontier = [rootId]
  for (let i = 0; i < 20 && frontier.length; i++) {
    const nuovi: string[] = []
    for (const f of frontier) for (const c of (figliDi.get(f) || [])) {
      if (seen.has(c)) continue
      seen.add(c); ids.push(c); nuovi.push(c)
    }
    frontier = nuovi
  }
  return ids
}

// Un Listino Corrieri è in SOLA LETTURA per il master se è un rivenditore PURO: ha un listino
// assegnato dal padre (parent_listino_id) E tutti i suoi contratti sono già posseduti da un
// antenato (li rivende soltanto). Se invece possiede almeno un contratto ORIGINALE (nome_contratto
// che nessun antenato ha, es. E&A che detiene BRT/Poste/UPS), è il titolare e può modificare.
export async function listinoCorrieriSolaLettura(adminDb: any, masterId: string): Promise<boolean> {
  if (!masterId) return false
  const { data: m } = await adminDb.from('masters').select('parent_master_id,parent_listino_id').eq('id', masterId).maybeSingle()
  if (!m?.parent_listino_id) return false   // nessun listino assegnato → titolare, editabile
  const { data: miei } = await adminDb.from('corrieri').select('nome_contratto').eq('master_id', masterId)
  const mieiNomi = (miei || []).map((c: any) => (c.nome_contratto || '').trim().toLowerCase()).filter(Boolean)
  if (!mieiNomi.length) return true   // nessun corriere proprio → solo rivendita
  // Nomi contratto posseduti dagli ANTENATI (catena parent_master_id)
  const antenati = new Set<string>()
  let cur: string | null = m.parent_master_id
  for (let i = 0; i < 20 && cur; i++) {
    const { data: ac } = await adminDb.from('corrieri').select('nome_contratto').eq('master_id', cur)
    for (const c of (ac || [])) { const n = (c.nome_contratto || '').trim().toLowerCase(); if (n) antenati.add(n) }
    const { data: pm } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = pm?.parent_master_id || null
  }
  // Possiede almeno un contratto originale (non di un antenato) → titolare → editabile
  const possiedeOriginale = mieiNomi.some((n: string) => !antenati.has(n))
  return !possiedeOriginale
}
