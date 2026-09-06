// PAVIMENTO PREZZO CLIENTE — sorgente unica dei minimi per contratto SpediamoPro.
//
// La regola (riga -22% del listino ufficiale, +IVA dove previsto) decide se un master può vendere una
// fascia al proprio CLIENTE FINALE. Vive nella tabella `pavimenti_prezzo`: modificabile senza rilascio
// e per più contratti. La dimensione ZONA: NULL = vale per tutte le zone (contratti nazionali, es. BRT
// Express/Poste), valorizzata per i contratti a zona (Europa: "BRT Estero 1", "UPS Estero 52", …).
// Qui c'è SOLO lettura + arrotondamento; l'esenzione (master o cliente) la decide il chiamante.

export type BandaPavimento = { peso_max: number; prezzo_min: number }
// nome_contratto -> (chiave zona -> bande). chiave '' = "tutte le zone" (riga con zona NULL).
export type MappaPavimenti = Map<string, Map<string, BandaPavimento[]>>

// Master esente (lui + discendenza) — flag masters.pavimento_esente, risalendo la catena.
export async function masterEsentePavimento(admin: any, masterId: string | null | undefined): Promise<boolean> {
  if (!masterId) return false
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    const res: any = await admin.from('masters').select('parent_master_id,pavimento_esente').eq('id', cur).maybeSingle()
    const row: any = res?.data
    if (!row) break
    if (row.pavimento_esente === true) return true
    cur = row.parent_master_id || null
  }
  return false
}

// Cliente esente: marcato lui (clienti.pavimento_esente) o esente il suo master (catena).
export async function clienteEsentePavimento(admin: any, clienteId: string | null | undefined): Promise<boolean> {
  if (!clienteId) return false
  const res: any = await admin.from('clienti').select('pavimento_esente,master_id').eq('id', clienteId).maybeSingle()
  const row: any = res?.data
  if (!row) return false
  if (row.pavimento_esente === true) return true
  return masterEsentePavimento(admin, row.master_id)
}

// Tutti i pavimenti attivi -> mappa nome -> (zona|'' -> bande). Una query per le liste.
export async function pavimentiAttivi(admin: any): Promise<MappaPavimenti> {
  const { data } = await admin.from('pavimenti_prezzo')
    .select('nome_contratto,zona,peso_max,prezzo_min').eq('attivo', true)
    .order('peso_max', { ascending: true })
  const out: MappaPavimenti = new Map()
  for (const r of (data || [])) {
    const nome = String((r as any).nome_contratto)
    const zk = (r as any).zona == null ? '' : String((r as any).zona)
    if (!out.has(nome)) out.set(nome, new Map())
    const pz = out.get(nome)!
    if (!pz.has(zk)) pz.set(zk, [])
    pz.get(zk)!.push({ peso_max: Number((r as any).peso_max), prezzo_min: Number((r as any).prezzo_min) })
  }
  return out
}

// Bande per (nome, zona) dalla mappa: prima la zona specifica, poi il fallback "tutte le zone" ('').
export function bandeDaMappa(mappa: MappaPavimenti, nome: string | null | undefined, zona: string | null | undefined): BandaPavimento[] {
  const pz = mappa?.get(String(nome || '')); if (!pz) return []
  return pz.get(String(zona || '')) || pz.get('') || []
}

// Bande per un contratto+zona leggendo dal DB (per crea/v1 che non hanno la mappa). Fallback: se non
// c'è la zona specifica, usa le righe senza zona (contratto nazionale).
export async function pavimentoContratto(admin: any, nome: string | null | undefined, zona?: string | null): Promise<BandaPavimento[]> {
  if (!nome) return []
  const { data } = await admin.from('pavimenti_prezzo')
    .select('zona,peso_max,prezzo_min').eq('nome_contratto', nome).eq('attivo', true)
    .order('peso_max', { ascending: true })
  const rows = (data || []) as any[]
  const spec = rows.filter(r => String(r.zona || '') === String(zona || '')).map(r => ({ peso_max: Number(r.peso_max), prezzo_min: Number(r.prezzo_min) }))
  if (spec.length) return spec
  return rows.filter(r => r.zona == null).map(r => ({ peso_max: Number(r.peso_max), prezzo_min: Number(r.prezzo_min) }))
}

// Minimo per una fascia: ARROTONDAMENTO IN SU — prima banda con peso_max >= peso; oltre l'ultima, l'ultima.
export function pavimentoPerPeso(bande: BandaPavimento[], pesoFascia: number): number | null {
  if (!bande || !bande.length) return null
  for (const b of bande) if (pesoFascia <= b.peso_max) return b.prezzo_min
  return bande[bande.length - 1].prezzo_min
}

// true se il prezzo è sotto il pavimento per quella fascia (tolleranza centesimo).
export function sottoPavimento(bande: BandaPavimento[], pesoFascia: number, prezzo: number | null | undefined): boolean {
  const pav = pavimentoPerPeso(bande, pesoFascia)
  if (pav == null || prezzo == null) return false
  return Number(prezzo) < pav - 0.0001
}

// Toglie dai risultati tariffa (vista/creazione CLIENTE) le opzioni sotto il pavimento: quella
// fascia/zona non è vendibile → il cliente non la vede e non ci spedisce. Confronto sul NOLO
// (weight_price), col pavimento della zona del listino (`_zona_listino`, fallback `zona`) e della
// fascia che copre il peso fatturato. NON chiamare per spedizione propria o listino all'ingrosso (M2M).
export function filtraRisultatiSottoPavimento(mappa: MappaPavimenti, risultati: any[]): any[] {
  if (!mappa || !mappa.size || !Array.isArray(risultati)) return risultati
  return risultati.filter((r: any) => {
    const bande = bandeDaMappa(mappa, r?.corriere_nome, r?._zona_listino ?? r?.zona)
    if (!bande.length) return true
    return !sottoPavimento(bande, Number(r?.peso_fatturato) || 0, Number(r?.weight_price))
  })
}
