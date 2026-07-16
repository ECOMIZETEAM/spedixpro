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

export type DestZona = { paese?: string; provincia?: string; cap?: string; citta?: string }

// Versione dettagliata: ritorna le zone matchate e se il CAP appartiene (cap-esatto) a una
// ZONA ESCLUSIVA (es. "Isole Minori"). Quando `capEsclusivo` e' true il jolly "resto Italia"
// NON copre il CAP: un corriere che avrebbe agganciato solo via jolly resta ESCLUSO (non ha
// quella zona speciale assegnata). Il chiamante deve anche saltare il fallback per nome "Italia".
export async function trovaZoneMatchDett(
  supabase: any,
  dest: DestZona,
  candidateZonaIds: string[],
  // Mappa zona_id -> corriere_id. Se passata, i tier (CAP>provincia>jolly) vengono applicati
  // SEPARATAMENTE per ogni corriere: così il CAP esatto di UN corriere non sopprime il match a
  // provincia/jolly degli ALTRI corrieri (era il bug del "1 corriere su N" per certi CAP).
  zonaCorriere?: Map<string, string>,
  // Insieme di zona_id "esclusive" (es. Isole Minori) tra le candidate.
  zoneEsclusive?: Set<string>
): Promise<{ ids: string[]; capEsclusivo: boolean }> {
  const paese = (dest.paese || 'IT').toUpperCase().trim()
  const provincia = (dest.provincia || '').toUpperCase().trim()
  const cap = (dest.cap || '').trim()

  const ids = Array.from(new Set(candidateZonaIds.filter(Boolean)))
  if (!ids.length) return { ids: [], capEsclusivo: false }

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
    .select('zona_id,provincia,cap,citta')
    .eq('paese', paese)
    .in('zona_id', ids)
    .in('cap', capFilter)
  let righe = zc || []

  // CITTÀ-AWARE (CAP condivisi): alcuni CAP coprono più comuni con trattamento diverso
  // (es. 25050 = Rodengo Saiano NORMALE e Monte Isola ISOLA; SpediamoPro distingue per città).
  // Le righe cap-esatto con una città SPECIFICA valgono SOLO per quel comune: se la destinazione
  // ha una città, scarto le righe cap-esatto di un comune DIVERSO, così il CAP non aggancia la
  // zona speciale sbagliata. (Senza città o senza righe-con-città: comportamento invariato.)
  const nrm = (s: any) => (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '')
  const dCitta = nrm((dest as any).citta)
  const capExactConCitta = righe.some((r: any) => r.cap && r.cap !== '*' && r.cap === cap && r.citta && r.citta !== '*')
  if (dCitta && capExactConCitta) {
    righe = righe.filter((r: any) => {
      const isCapExactSpecifica = r.cap && r.cap !== '*' && r.cap === cap && r.citta && r.citta !== '*'
      return !isCapExactSpecifica || nrm(r.citta) === dCitta   // tieni se non è cap-esatto-specifica, o se la città combacia
    })
  }

  // Il CAP appartiene (cap-esatto) a una zona ESCLUSIVA? (es. Isole Minori)
  const capEsclusivo = !!cap && !!zoneEsclusive && zoneEsclusive.size > 0 &&
    righe.some((r: any) => r.cap && r.cap !== '*' && r.cap === cap && zoneEsclusive.has(r.zona_id))
  // In tal caso il jolly totale ('*'/'*' = resto Italia) NON deve coprire il CAP: tolgo quelle
  // righe così un corriere senza la zona speciale (che aggancerebbe solo via jolly) resta escluso.
  if (capEsclusivo) {
    righe = righe.filter((r: any) => !((!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*')))
  }

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
    return { ids: Array.from(new Set(pickTier(righe).map((r: any) => r.zona_id).filter(Boolean))), capEsclusivo }
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
  return { ids: Array.from(out), capEsclusivo }
}

// Compat: ritorna solo le zone matchate (usato dove il flag esclusivo non serve).
export async function trovaZoneMatch(
  supabase: any,
  dest: DestZona,
  candidateZonaIds: string[],
  zonaCorriere?: Map<string, string>,
  zoneEsclusive?: Set<string>
): Promise<string[]> {
  return (await trovaZoneMatchDett(supabase, dest, candidateZonaIds, zonaCorriere, zoneEsclusive)).ids
}

// Nomi di zona considerate "esclusive": un CAP che vi appartiene NON è raggiungibile via il
// jolly "resto Italia". Serve a non far spedire un corriere che non ha quella zona assegnata.
// Comprende le ISOLE MINORI e le ZONE DISAGIATE/PERIFERICHE: se il listino non prezza quella
// zona speciale, il corriere NON compare per quella destinazione (niente ripiego su "Italia" a
// prezzo pieno) — un altro corriere che ha la zona impostata la coprirà.
export function isZonaEsclusiva(nome: string | null | undefined): boolean {
  return /isole?\s*minori/i.test(String(nome || '')) || isZonaDisagiata(nome)
}

// Nomi di zona "disagiata/periferica": zone speciali a supplemento (es. "Zone Disagiate",
// "Località Periferiche", "Cap Disagiati").
export function isZonaDisagiata(nome: string | null | undefined): boolean {
  return /disagiat|periferic/i.test(String(nome || ''))
}

// Zone ESCLUSIVE (isole minori + disagiate) di un MASTER, per i corrieri indicati. Servono a
// riconoscere una destinazione "esclusiva" ANCHE quando il listino in esame NON ha la fascia
// speciale: così `capEsclusivo` scatta lo stesso e il corriere senza quella fascia NON aggancia
// via "Italia" a prezzo pieno (verrebbe venduto sotto costo). Ritorna gli id-zona da aggiungere
// sia alle candidate (per caricare le righe cap-esatto) sia all'insieme `zoneEsclusive`.
// NB: NON vanno messe nella mappa zona->corriere del chiamante, così non creano match "gratis".
export async function zoneEsclusiveMaster(supabase: any, corriereIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set((corriereIds || []).filter(Boolean)))
  if (!ids.length) return []
  const { data } = await supabase.from('zone').select('id,nome').in('corriere_id', ids)
  return (data || []).filter((z: any) => isZonaEsclusiva((z as any).nome)).map((z: any) => (z as any).id)
}

// Regola DISAGIATA (per-corriere): restituisce, per i corrieri indicati, la zona disagiata del
// master che contiene (CAP-esatto) il CAP di destinazione. Se un corriere è nella mappa, per
// quella destinazione può usare SOLO quella zona: se il listino in esame non la prezza → NIENTE
// tariffa (nessun ripiego su provincia/Italia: la tariffa disagiata non gli è stata assegnata).
// Il controllo è sull'INTERO set zone del master (anche zone NON presenti nel listino in esame),
// così vale anche quando il cliente/sotto-master non ha affatto la fascia disagiata.
// Agisce SOLO sui CAP realmente elencati in una zona disagiata → zero impatto sui CAP normali.
export async function mappaCapDisagiata(
  supabase: any,
  masterId: string | null | undefined,
  corriereIds: string[],
  paese: string | null | undefined,
  cap: string | null | undefined
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set((corriereIds || []).filter(Boolean)))
  const c = (cap || '').trim()
  if (!masterId || !ids.length || !c || (paese || 'IT').toUpperCase().trim() !== 'IT') return out
  const { data } = await supabase
    .from('zone')
    .select('id,nome,corriere_id, zone_cap!inner(cap)')
    .eq('master_id', masterId)
    .in('corriere_id', ids)
    .eq('zone_cap.cap', c)
  for (const z of (data || [])) {
    const cid = (z as any).corriere_id
    if (isZonaDisagiata((z as any).nome) && cid && !out.has(cid)) out.set(cid, (z as any).id)
  }
  return out
}
