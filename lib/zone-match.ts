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

// CITTÀ-AWARE (CAP condivisi): alcuni CAP coprono più comuni con trattamento diverso
// (es. 25050 = Rodengo Saiano NORMALE e Monte Isola ISOLA; 65010 = Spoltore NORMALE e
// Civitella Casanova DISAGIATA). Le righe cap-esatto con una città SPECIFICA valgono SOLO
// per quel comune: se la destinazione ha una città, scarto le righe cap-esatto di un comune
// DIVERSO, così il CAP non aggancia la zona speciale sbagliata. (Senza città o senza
// righe-con-città: righe invariate.) Condiviso col matching batch di lib/pricing.
const nrmCitta = (s: any) => (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '')

// UNA RIGA CHE NOMINA UN COMUNE VALE SOLO PER QUEL COMUNE.
// Il match per PROVINCIA (secondo criterio, quando il CAP non combacia) guardava solo la provincia
// e ignorava del tutto la colonna `citta`. Cosi' una riga come "VE / * / BURANO" — messa li' per
// dire che Burano e' un'isola minore — agganciava TUTTA la provincia di Venezia, Mestre compresa:
// mezzo Veneto veniva prezzato (o escluso) come isola minore. Lo stesso vale per le Isole Tremiti
// su tutta Foggia, l'Isola del Giglio su tutta Grosseto, Porto Azzurro su tutta Livorno.
// Se la riga ha un comune specifico deve combaciare; se il comune non e' indicato nella
// destinazione, la riga specifica NON si applica (meglio non prezzare che prezzare l'isola).
export function rigaValePerCitta(r: any, citta?: string | null): boolean {
  const rc = r?.citta
  if (!rc || rc === '*') return true
  return nrmCitta(rc) === nrmCitta(citta)
}

export function filtraCapCondiviso(righe: any[], cap: string, citta?: string | null): any[] {
  const nrm = nrmCitta
  const dCitta = nrm(citta)
  if (!dCitta) return righe
  const capExactConCitta = righe.some((r: any) => r.cap && r.cap !== '*' && r.cap === cap && r.citta && r.citta !== '*')
  if (!capExactConCitta) return righe
  return righe.filter((r: any) => {
    const isCapExactSpecifica = r.cap && r.cap !== '*' && r.cap === cap && r.citta && r.citta !== '*'
    return !isCapExactSpecifica || nrm(r.citta) === dCitta   // tieni se non è cap-esatto-specifica, o se la città combacia
  })
}

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
  // Mappa zona_id -> corriere_id delle zone ESCLUSIVE (Isole/Disagiate/Sardegna/…). L'esclusione
  // dal jolly "Italia" è PER-CORRIERE: un CAP esclusivo per BRT NON deve toccare Poste. `capEsclusivo`
  // resta come flag globale di compatibilità (true se almeno un corriere risulta escluso).
  esclCorr?: Map<string, string>
): Promise<{ ids: string[]; capEsclusivo: boolean; corrieriEsclusi: Set<string> }> {
  const paese = (dest.paese || 'IT').toUpperCase().trim()
  const provincia = (dest.provincia || '').toUpperCase().trim()
  const cap = (dest.cap || '').trim()

  const ids = Array.from(new Set(candidateZonaIds.filter(Boolean)))
  if (!ids.length) return { ids: [], capEsclusivo: false, corrieriEsclusi: new Set() }

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

  righe = filtraCapCondiviso(righe, cap, (dest as any).citta)

  // Esclusione PER-CORRIERE: la destinazione è "esclusiva" per un corriere SOLO se appartiene a
  // una zona esclusiva DI QUEL corriere (Isole/Disagiate/Livigno per CAP-ESATTO; Sardegna/Sicilia/
  // Calabria per PROVINCIA). Così un CAP disagiato per BRT non toglie il jolly "Italia" a Poste.
  // A PARITA' DI CAP, VINCE LA RIGA CHE NOMINA IL COMUNE.
  //
  // Lo stesso CAP puo' stare in DUE zone dello stesso contratto: 98055 Lipari e' sia in "SCS" (con
  // il comune a jolly, perche' Lipari e' in Sicilia) sia in "Isole Minori" (col comune scritto).
  // Vincevano entrambe, e siccome il listino prezzava SCS ma non Isole Minori, Lipari veniva
  // venduta al prezzo della Sicilia — molto meno di quanto costa spedire su un'isola minore.
  //
  // Chi scrive il comune in una riga sta dicendo qualcosa di piu' preciso di chi lascia il jolly:
  // quella riga vale di piu'. Se la zona piu' precisa non e' prezzata, la destinazione resta
  // scoperta — che e' esattamente il comportamento voluto, non un effetto collaterale.
  const piuSpecifica = (rows: any[]): any[] => {
    const citta = String((dest as any).citta || '').trim().toUpperCase()
    if (!citta) return rows
    const conComune = rows.filter((r: any) => {
      const c = String(r.citta || '').trim().toUpperCase()
      return c && c !== '*' && c === citta
    })
    return conComune.length ? conComune : rows
  }

  const corrieriEsclusi = new Set<string>()
  // Esclusi per CAP-ESATTO (destinazione in una zona speciale a match cap-esatto: Zone Disagiate,
  // Isole Minori, Livigno). Per questi il ripiego su provincia/Italia NON è ammesso: se il corriere
  // non prezza proprio quella zona speciale, la destinazione è scoperta → corriere ESCLUSO del tutto.
  // (Diverso dalle zone a PROVINCIA come Sardegna/Sicilia/Calabria, che il cliente prezza e usa.)
  const corrieriCapEsclusi = new Set<string>()
  // corriere -> zone che rivendicano QUESTO cap (per non farlo passare via il jolly di un'altra)
  const capEsclusiviZone = new Map<string, Set<string>>()
  if (esclCorr && esclCorr.size) {
    // Fra le righe a CAP esatto tengo solo le piu' specifiche: e' quella la zona che rivendica
    // davvero la destinazione. Senza questo, la riga jolly di un'altra zona (SCS: 98055/*) contava
    // quanto quella che scrive "Lipari", e vinceva la piu' economica.
    // OGNI CONTRATTO PER CONTO SUO, ED E' IL PUNTO DELICATO.
    // "Vince la riga che nomina il comune" e' una regola che vale DENTRO un contratto: serve a
    // decidere quale delle SUE zone rivendica la destinazione. Applicandola a tutte le righe
    // insieme faceva un danno: bastava che UN contratto qualsiasi del listino scrivesse il comune,
    // e le righe cap-esatto di tutti gli ALTRI venivano buttate via — quei corrieri non finivano
    // fra gli esclusi, ripiegavano sul jolly e vendevano un'isola minore al prezzo dell'Italia.
    // Portoferraio venduta 4,85 e pagata 9,79; e cosi' Anacapri, Pantelleria, Lampedusa, Murano.
    // Venti spedizioni in due giorni, circa 1.200 euro al mese.
    const capEsatteRighe = righe.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap)
    const perCorriere = new Map<string, any[]>()
    for (const r of capEsatteRighe) {
      const cc = esclCorr.get(r.zona_id) || '(senza corriere)'
      if (!perCorriere.has(cc)) perCorriere.set(cc, [])
      perCorriere.get(cc)!.push(r)
    }
    const capEsatte = new Set<any>()
    for (const gruppo of perCorriere.values()) for (const r of piuSpecifica(gruppo)) capEsatte.add(r)
    for (const r of righe) {
      if (r.cap && r.cap !== '*' && r.cap === cap && !capEsatte.has(r)) continue
      const cc = esclCorr.get(r.zona_id)
      if (!cc) continue
      const capMatch = !!r.cap && r.cap !== '*' && r.cap === cap
      const provMatch = !!r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*')
        && rigaValePerCitta(r, (dest as any).citta)   // "VE/*/BURANO" non vale per tutta Venezia
      if (capMatch || provMatch) corrieriEsclusi.add(cc)
      if (capMatch) {
        corrieriCapEsclusi.add(cc)
        if (!capEsclusiviZone.has(cc)) capEsclusiviZone.set(cc, new Set())
        capEsclusiviZone.get(cc)!.add(r.zona_id)
      }
    }
  }
  const capEsclusivo = corrieriEsclusi.size > 0   // flag globale (compat)

  // Per un corriere escluso per CAP-ESATTO: il match è valido SOLO se è a sua volta cap-esatto (cioè
  // il corriere prezza davvero quella zona speciale). Altrimenti il ripiego su provincia/jolly va
  // scartato → il corriere non copre la destinazione (niente vendita sotto costo su Sardegna/Italia).
  const filtraCapEscluso = (c: string, picked: any[]): any[] => {
    if (!corrieriCapEsclusi.has(c)) return picked
    // Il match cap-esatto vale solo se viene da una zona che quel CAP lo rivendica DAVVERO, cioe'
    // una di quelle che hanno fatto scattare l'esclusione. Bastava una riga jolly di un'altra zona
    // (es. "SCS: 98055 / *") per far passare il corriere sul prezzo sbagliato.
    const buone = capEsclusiviZone.get(c)
    return picked.some((r: any) => r.cap && r.cap !== '*' && r.cap === cap && (!buone || buone.has(r.zona_id)))
      ? picked : []
  }

  // Applica i 3 tier (CAP esatto > provincia+cap* > jolly totale) su un insieme di righe.
  const pickTier = (rows: any[]): any[] => {
    let m = piuSpecifica(rows.filter((r: any) => r.cap && r.cap !== '*' && r.cap === cap))                    // 1) CAP esatto
    // 2) provincia — ma una riga che nomina un comune vale solo per quel comune (vedi rigaValePerCitta)
    if (!m.length) m = rows.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*') && rigaValePerCitta(r, (dest as any).citta))
    if (!m.length) m = rows.filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))  // 3) jolly
    return m
  }
  // Toglie il jolly totale ('*'/'*' = resto Italia) da un insieme di righe.
  const senzaJolly = (rows: any[]): any[] => rows.filter((r: any) => !((!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*')))

  // Senza mappa corriere: le candidate sono già di UN solo corriere → se la dest è esclusiva per
  // quel corriere si toglie il jolly (comportamento globale, invariato).
  if (!zonaCorriere) {
    const rr = capEsclusivo ? senzaJolly(righe) : righe
    // candidate di UN solo corriere: se è escluso per cap-esatto e il match non è cap-esatto → niente.
    let picked = pickTier(rr)
    if (corrieriCapEsclusi.size && !picked.some((r: any) => r.cap && r.cap !== '*' && r.cap === cap)) picked = []
    return { ids: Array.from(new Set(picked.map((r: any) => r.zona_id).filter(Boolean))), capEsclusivo, corrieriEsclusi }
  }

  // Con mappa: tier PER CORRIERE; il jolly si toglie SOLO ai corrieri per cui la dest è esclusiva.
  const perCorr = new Map<string, any[]>()
  for (const r of righe) {
    const c = zonaCorriere.get(r.zona_id)
    if (!c) continue
    if (!perCorr.has(c)) perCorr.set(c, [])
    perCorr.get(c)!.push(r)
  }
  const out = new Set<string>()
  for (const [c, rows] of perCorr) {
    const rr = corrieriEsclusi.has(c) ? senzaJolly(rows) : rows
    for (const r of filtraCapEscluso(c, pickTier(rr))) out.add(r.zona_id)
  }
  return { ids: Array.from(out), capEsclusivo, corrieriEsclusi }
}

// Compat: ritorna solo le zone matchate (usato dove il flag esclusivo non serve).
export async function trovaZoneMatch(
  supabase: any,
  dest: DestZona,
  candidateZonaIds: string[],
  zonaCorriere?: Map<string, string>,
  esclCorr?: Map<string, string>
): Promise<string[]> {
  return (await trovaZoneMatchDett(supabase, dest, candidateZonaIds, zonaCorriere, esclCorr)).ids
}

// Nomi di zona considerate "esclusive": una destinazione che vi appartiene NON è raggiungibile
// via il jolly "resto Italia". Serve a non far spedire un corriere che non ha quella zona
// assegnata. Comprende: ISOLE MINORI, ZONE DISAGIATE/PERIFERICHE (match cap-esatto) e le zone
// maggiori a supplemento SARDEGNA/SICILIA/CALABRIA/LIVIGNO (match per provincia o cap-esatto).
// Se il listino non prezza quella zona speciale, il corriere NON compare per quella destinazione
// (niente ripiego su "Italia" a prezzo pieno) — un altro corriere che ha la zona la coprirà.
export function isZonaEsclusiva(nome: string | null | undefined): boolean {
  const n = String(nome || '')
  return /isole?\s*minori/i.test(n) || isZonaDisagiata(n) || /\b(sardegna|sicilia|calabria|livigno|scs)\b/i.test(n)
}

// Nomi di zona "disagiata/periferica": zone speciali a supplemento (es. "Zone Disagiate",
// "Località Periferiche", "Cap Disagiati").
export function isZonaDisagiata(nome: string | null | undefined): boolean {
  return /disagiat|periferic/i.test(String(nome || ''))
}

// Zone ESCLUSIVE (isole/disagiate/sardegna/…) di un MASTER, per i corrieri indicati. Servono a
// riconoscere una destinazione "esclusiva" ANCHE quando il listino in esame NON ha la fascia
// speciale: così l'esclusione scatta lo stesso e il corriere senza quella fascia NON aggancia via
// "Italia" a prezzo pieno (verrebbe venduto sotto costo). Ritorna le coppie {zona, corriere}: la
// zona va tra le candidate (per caricare le righe) e nella mappa esclCorr (esclusione PER-CORRIERE).
// NB: NON vanno messe nella mappa zona->corriere di MATCH, così non creano tariffe "gratis".
export async function zoneEsclusiveMaster(
  supabase: any, corriereIds: string[], cap?: string | null
): Promise<Array<{ id: string; corriere_id: string }>> {
  const ids = Array.from(new Set((corriereIds || []).filter(Boolean)))
  if (!ids.length) return []
  const out = new Map<string, string>()

  const { data } = await supabase.from('zone').select('id,nome,corriere_id').in('corriere_id', ids)
  for (const z of (data || [])) if (isZonaEsclusiva((z as any).nome)) out.set((z as any).id, (z as any).corriere_id)

  // REGOLA UNIVERSALE: se una zona elenca ESPLICITAMENTE questo CAP, per quella destinazione vale
  // quella zona e nessun'altra — come si chiami la zona non conta.
  //
  // Prima l'esclusione dipendeva dal NOME ("disagiate", "isole minori", "sardegna"…): una zona
  // chiamata "Zona 3" non era riconosciuta, e una destinazione che il corriere fa pagare di piu'
  // ripiegava sul jolly "Italia" a prezzo base. Ma chi si prende la briga di elencare un CAP per
  // nome dentro una zona sta dicendo esattamente questo: per quel CAP vale QUESTA zona. Se il
  // listino non la prezza, il corriere non copre la destinazione — e ne comparira' un altro che
  // quella zona ce l'ha.
  const c = String(cap || '').trim()
  if (c) {
    const { data: perCap } = await supabase.from('zone')
      .select('id,corriere_id, zone_cap!inner(cap)')
      .in('corriere_id', ids).eq('zone_cap.cap', c)
    for (const z of (perCap || [])) out.set((z as any).id, (z as any).corriere_id)
  }
  return Array.from(out, ([id, corriere_id]) => ({ id, corriere_id }))
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
