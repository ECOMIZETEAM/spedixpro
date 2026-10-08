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

// NOMI DEI CONTRATTI CHE UN MASTER POSSIEDE (li detiene o li rivende: ha una riga in `corrieri`
// con quel `nome_contratto`). È la chiave della VISIBILITÀ DI RETE: un master vede le spedizioni
// dei suoi discendenti SOLO su questi contratti. Se il sub ha spedito con un contratto PRIVATO suo
// (un nome che il master non possiede), il master non c'entra — nessun suo movimento — e non deve
// vederla. Verificato sui movimenti reali: "ho un movimento sulla spedizione" ⇒ "possiedo quel
// nome_contratto" (0 eccezioni su 351.985 coppie), quindi filtrare per nome NON nasconde mai a un
// master una spedizione che lo riguarda. Il match è per stringa ESATTA (i nomi si propagano uguali
// lungo la catena di rivendita). Ritorna [] se il master non ha contratti (raro: non spedisce).
export async function contrattiPossedutiNomi(adminDb: any, masterId?: string | null): Promise<string[]> {
  if (!masterId) return []
  const { data } = await adminDb.from('corrieri').select('nome_contratto').eq('master_id', masterId)
  // Il confronto a valle è SEMPRE contro il valore GREZZO di corrieri.nome_contratto
  // (q.in('corrieri.nome_contratto', …) in lista/giacenze/distinte/contrassegni/statistiche/dashboard/
  // reports/ritirabili): il nome va quindi restituito ESATTAMENTE com'è salvato. Il .trim() di prima lo
  // normalizzava e così un contratto PROPRIO con uno spazio di troppo nel nome ("GLS CASERTA RITIRO ")
  // non combaciava più nemmeno con le SUE stesse spedizioni, che sparivano dalla vista-rete del detentore
  // — 252 di Evolution Commerce su MULTIEXPRESS, viste come "GLS" che non si trovavano (8/10/2026).
  // Tengo ANCHE la forma trimmata: è un SOVRAINSIEME (non nasconde nulla che prima si vedeva) e copre
  // il caso di una copia del sub con spazi diversi da quelli del detentore.
  const nomi = new Set<string>()
  for (const c of (data || [])) {
    const raw = (c as any).nome_contratto == null ? '' : String((c as any).nome_contratto)
    const t = raw.trim()
    if (!t) continue        // nome vuoto o solo-spazi: niente da possedere
    nomi.add(raw)           // com'è salvato: è così che lo confronta chi filtra
    nomi.add(t)             // difensivo: copie con spazi ai bordi diversi dal detentore
  }
  return Array.from(nomi)
}

// true se `targetId` sta SOTTO `masterId` nella catena (figlio diretto o più in basso).
// Risale dal target: poche letture anche su reti profonde. Usato per autorizzare la lettura
// dei dati di un sotto-master: limitarsi ai figli DIRETTI faceva tornare liste vuote, senza
// spiegazione, a chi guarda da un nodo alto della rete.
export async function eDiscendente(adminDb: any, targetId?: string | null, masterId?: string | null): Promise<boolean> {
  if (!targetId || !masterId) return false
  let cur: string | null = targetId
  for (let i = 0; i < 20 && cur; i++) {
    const { data: m }: { data: any } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = m?.parent_master_id || null
    if (cur === masterId) return true
  }
  return false
}

// I corrieri (per ID) in SOLA LETTURA per il master: quelli che NON detiene (`corrieri.proprio=false`)
// — copie di cascata-albero o contratti acquistati in condivisione. Il prezzo di un contratto lo decide
// chi lo DETIENE (proprio=true), non chi lo rivende. Ritorna un Set di `corrieri.id` di sola lettura
// (vuoto = tutti propri → tutto modificabile).
//
// PERCHÉ `proprio` e non più albero+nome: la vecchia versione risaliva parent_master_id e marcava sola
// lettura i contratti con lo stesso NOME di un antenato. Sbaglia sulla condivisione-codice, dove i due
// grafi vanno in versi OPPOSTI (es. SDA EXPRESS L: LOGIXIA lo DETIENE e lo vende verso l'alto a MULTI,
// ma nell'albero MULTI sta sopra LOGIXIA): risultato INVERTITO — il rivenditore MULTI poteva modificare
// e il detentore LOGIXIA era bloccato. `proprio` è l'unico marcatore affidabile del detentore, allineato
// alla guardia RLS in DB. A livello contratto: un master misto modifica i suoi (proprio=true) e vede-
// soltanto le copie (proprio=false).
export async function corrieriEreditatiIds(adminDb: any, masterId: string): Promise<Set<string>> {
  const ereditati = new Set<string>()
  if (!masterId) return ereditati
  const { data: miei } = await adminDb.from('corrieri').select('id,proprio').eq('master_id', masterId)
  for (const c of (miei || [])) { if (!(c as any).proprio) ereditati.add((c as any).id) }
  return ereditati
}

// Banner master-level: il Listino Corrieri è tutto in SOLA LETTURA se il master è un rivenditore PURO,
// cioè non DETIENE alcun contratto (nessun `corrieri.proprio=true`). Se possiede almeno un contratto
// proprio è un detentore (anche misto): niente banner, la sola-lettura si decide contratto-per-contratto
// con corrieriEreditatiIds. Vedi lì il perché di `proprio` al posto di albero+nome.
export async function listinoCorrieriSolaLettura(adminDb: any, masterId: string): Promise<boolean> {
  if (!masterId) return false
  const { data: miei } = await adminDb.from('corrieri').select('proprio').eq('master_id', masterId)
  if (!miei?.length) return false   // nessun corriere → niente da mostrare
  return !miei.some((c: any) => c.proprio)   // nessun proprio → rivenditore puro → tutto sola lettura
}
