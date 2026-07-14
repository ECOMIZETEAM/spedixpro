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
  candidateZonaIds: string[]
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

  // 1) CAP esatto
  let match = righe.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
  // 2) provincia (cap jolly)
  if (!match.length) {
    match = righe.filter((r: any) =>
      r.provincia && r.provincia !== '*' &&
      r.provincia.toUpperCase() === provincia &&
      (!r.cap || r.cap === '*'))
  }
  // 3) jolly totale
  if (!match.length) {
    match = righe.filter((r: any) =>
      (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))
  }

  return Array.from(new Set(match.map((r: any) => r.zona_id).filter(Boolean)))
}
