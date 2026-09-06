// PAVIMENTO PREZZO CLIENTE — sorgente unica dei minimi per contratto SpediamoPro.
//
// La regola (riga -22% del listino ufficiale) decide se un master può vendere una fascia al proprio
// CLIENTE FINALE. Vive nella tabella `pavimenti_prezzo` così è modificabile senza rilascio e si
// estende ad altri contratti (oggi BRT Express attivo; Poste pronto ma spento). Qui c'è SOLO la
// lettura + la regola di arrotondamento; l'esenzione Master->Master la decide il chiamante
// (il pavimento NON vale sul listino che un master assegna a un sotto-master).

export type BandaPavimento = { peso_max: number; prezzo_min: number }

// Master esente dal pavimento: lui e tutta la sua discendenza (es. AGENZIA ENTRATE RISCOSSIONE).
// Si risale la catena finché non si trova un antenato marcato `pavimento_esente`. Flag, non id/nome.
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

// Bande attive del pavimento per un contratto (per nome), ordinate per peso. [] se nessun pavimento.
export async function pavimentoContratto(admin: any, nomeContratto: string | null | undefined): Promise<BandaPavimento[]> {
  if (!nomeContratto) return []
  const { data } = await admin.from('pavimenti_prezzo')
    .select('peso_max,prezzo_min')
    .eq('nome_contratto', nomeContratto).eq('attivo', true)
    .order('peso_max', { ascending: true })
  return (data || []).map((r: any) => ({ peso_max: Number(r.peso_max), prezzo_min: Number(r.prezzo_min) }))
}

// Tutti i contratti con pavimento attivo -> mappa nome_contratto -> bande. Una query sola per le liste.
export async function pavimentiAttivi(admin: any): Promise<Map<string, BandaPavimento[]>> {
  const { data } = await admin.from('pavimenti_prezzo')
    .select('nome_contratto,peso_max,prezzo_min')
    .eq('attivo', true)
    .order('peso_max', { ascending: true })
  const out = new Map<string, BandaPavimento[]>()
  for (const r of (data || [])) {
    const k = String((r as any).nome_contratto)
    if (!out.has(k)) out.set(k, [])
    out.get(k)!.push({ peso_max: Number((r as any).peso_max), prezzo_min: Number((r as any).prezzo_min) })
  }
  return out
}

// Minimo per una fascia di peso: ARROTONDAMENTO IN SU — prima banda con peso_max >= peso della
// fascia; se il peso supera l'ultima banda, si usa l'ultima. null se non c'è pavimento.
// Es. BRT: fascia 2 kg -> banda 3 kg (4,59); fascia 70 kg -> banda 75 kg (18,96).
export function pavimentoPerPeso(bande: BandaPavimento[], pesoFascia: number): number | null {
  if (!bande || !bande.length) return null
  for (const b of bande) if (pesoFascia <= b.peso_max) return b.prezzo_min
  return bande[bande.length - 1].prezzo_min
}

// true se il prezzo dato è sotto il pavimento per quella fascia (tolleranza centesimo per i float).
export function sottoPavimento(bande: BandaPavimento[], pesoFascia: number, prezzo: number | null | undefined): boolean {
  const pav = pavimentoPerPeso(bande, pesoFascia)
  if (pav == null || prezzo == null) return false
  return Number(prezzo) < pav - 0.0001
}

// Toglie dai risultati tariffa (vista/creazione CLIENTE) le opzioni sotto il pavimento: per quella
// fascia/zona il cliente non vede il prezzo e non può spedire. Confronto sul NOLO (weight_price),
// col pavimento della fascia che copre il peso fatturato (arrotondamento in su). NON chiamare per
// spedizione propria del master o per il listino all'ingrosso di un sotto-master (M2M esenti).
export function filtraRisultatiSottoPavimento(pav: Map<string, BandaPavimento[]>, risultati: any[]): any[] {
  if (!pav || !pav.size || !Array.isArray(risultati)) return risultati
  return risultati.filter((r: any) => {
    const bande = pav.get(String(r?.corriere_nome || ''))
    if (!bande) return true
    return !sottoPavimento(bande, Number(r?.peso_fatturato) || 0, Number(r?.weight_price))
  })
}
