// Matching CAP/provincia/paese -> zona, condiviso tra il preventivo cliente
// (app/api/spedizioni/tariffe) e il motore di pricing della cascata (lib/pricing).
//
// La tabella `zone_cap` contiene, per ogni zona, le righe geografiche:
//   paese (country_id) / provincia / cap / citta   con `*` = jolly.
//
// Regola di priorita del match (come spedisci.online):
//   1) CAP esatto
//   2) provincia (cap jolly)
//   3) jolly totale (provincia * e cap *)  -> tipico estero / "resto Italia"
//
// Per evitare bleed cross-master, il match e' ristretto alle zone gia'
// candidate (quelle presenti nelle fasce del listino in esame).

export type DestZona = { paese?: string; provincia?: string; cap?: string }

export async function trovaZoneMatch(
  supabase: any,
  dest: DestZona,
  candidateZonaIds: string[],
  // Mappa zona_id -> corriere_id. Se passata, i tier (CAP>provincia>jolly) vengono applicati
  // SEPARATAMENTE per ogni corriere: così il CAP esatto di UN corriere non sopprime il match a
  // provincia/jolly degli ALTRI corrieri (era il bug del "1 corriere su N" per certi CAP).
  zonaCorriere?: Map<string, string>
): Promise<string[]> {
  const paese = (dest.paese || 'IT').toUpperCase().trim()
  const provincia = (dest.provincia || '').toUpperCase().trim()
  const cap = (dest.cap || '').trim()

  const ids = Array.from(new Set(candidateZonaIds.filter(Boolean)))
  if (!ids.length) return []

  // IMPORTANTE: scarichiamo SOLO le righe che i tier di match possono usare, cioè
  //   - cap esatto della destinazione   (tier 1)
  //   - cap jolly '*'                    (tier 2 provincia+cap*, e tier 3 jolly totale)
  // Prima si scaricavano TUTTE le righe delle zone candidate: con listini grandi si
  // superavano le 1000 righe (limite PostgREST) e alcune zone (es. il jolly "Italia" di
  // un corriere) venivano troncate -> quel corriere spariva dalle tariffe. Filtrando sul
  // cap il numero di righe resta minimo e non si tronca mai. (Nessuna riga usa cap NULL.)
  const capFilter = Array.from(new Set([cap, '*'].filter((v) => v != null && v !== undefined))) as string[]
  const { data: zc } = await supabase
    .from('zone_cap')
    .select('zona_id,provincia,cap')
    .eq('paese', paese)
    .in('zona_id', ids)
    .in('cap', capFilter)
  const righe = zc || []

  // Applica i 3 tier (CAP esatto > provincia+cap* > jolly totale) su un insieme di righe.
  const pickTier = (rows: any[]): any[] => {
    let m = rows.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)                                   // 1) CAP esatto
    if (!m.length) m = rows.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*')) // 2) provincia
    if (!m.length) m = rows.filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))  // 3) jolly
    return m
  }

  // Senza mappa corriere: comportamento globale (usato dove le zone candidate sono già di un
  // solo corriere, es. listino corriere per-corriere).
  if (!zonaCorriere) {
    return Array.from(new Set(pickTier(righe).map((r: any) => r.zona_id).filter(Boolean)))
  }

  // Con mappa: tier PER CORRIERE, così ogni corriere trova la SUA zona migliore in autonomia.
  const perCorr = new Map<string, any[]>()
  for (const r of righe) {
    const c = zonaCorriere.get(r.zona_id)
    if (!c) continue
    if (!perCorr.has(c)) perCorr.set(c, [])
    perCorr.get(c)!.push(r)
  }
  const out = new Set<string>()
  for (const rows of perCorr.values()) for (const r of pickTier(rows)) out.add(r.zona_id)
  return Array.from(out)
}
