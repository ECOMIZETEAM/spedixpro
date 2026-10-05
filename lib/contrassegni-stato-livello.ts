import { fetchAll } from '@/lib/fetch-all'
import { caricaSorgenteCatena, detentoreContrattoCon } from '@/lib/contratto-per-nome'

// IL COLORE DEL CONTRASSEGNO, LIVELLO PER LIVELLO: dice se i soldi sono arrivati A ME.
//
// Lo stesso contrassegno passa di mano più volte: il corriere paga il detentore del contratto, il
// detentore paga il sotto-master, quello paga il successivo, l'ultimo paga il cliente. Ognuno di
// questi passaggi è una distinta diversa, quindi "pagato" non è un fatto solo: dipende da chi guarda.
//
// Regola, decisa dall'owner il 22/09/2026: **verde quando ho incassato io**.
//  - grigio (in attesa): nessuno mi ha ancora messo in distinta;
//  - arancio (in lavorazione): sono in una distinta che mi riguarda, non ancora pagata;
//  - verde (pagato): quella distinta è pagata.
// Chi ha qualcuno sopra guarda la distinta IN ENTRATA (quella con cui il livello sopra lo paga). Il
// DETENTORE non ha nessuno sopra — incassa dal corriere — e guarda la SUA: finché non ha pagato chi
// sta sotto, per lui non è chiusa.
//
// Cambia la regola del 13/08 ("ho pagato il mio cliente → verde comunque"): un sotto-master che
// anticipa al suo cliente vedeva verde un contrassegno che non ha ancora ricevuto. Il conto verso il
// cliente è un'altra tratta, e ha il suo colore nel portale del cliente.
//
// `spedizioni.stato_contrassegno` resta lo stato del CLIENTE finale (è quello che vede lui): qui non
// si tocca, si calcola una vista per chi sta guardando.

export type StatoCodLivello = 'in_attesa' | 'in_distinta' | 'pagato' | 'annullato'

export type CodPerLivello = {
  stato: StatoCodLivello
  sonoDetentore: boolean
  /** La MIA distinta (quella con cui pago chi sta sotto), se c'è. */
  mia?: { id: string; numero: number; stato: string }
  /** La distinta con cui il livello sopra paga ME, se c'è. */
  inEntrata?: { id: string; numero: number; stato: string }
  /** Posso ancora metterlo in una distinta mia: quei soldi passano da me, non ci è già dentro, non è un reso. */
  selezionabile: boolean
  /** Quanto ho DAVVERO incassato per questa spedizione (importo_cod della MIA riga-distinta), se c'è.
   *  Su un COD PARZIALE è MENO del dichiarato (spedizioni.contrassegno): serve alla UI per segnarlo in blu. */
  incassato?: number
}

type RigaSped = {
  id: string
  master_id?: string | null
  tracking_number?: string | null
  stato_contrassegno?: string | null
  distinta_contrassegno_id?: string | null
  corrieri?: { nome_contratto?: string | null } | null
}

export async function statiCodPerLivello(
  adminDb: any, masterId: string, righe: RigaSped[]
): Promise<Map<string, CodPerLivello>> {
  const out = new Map<string, CodPerLivello>()
  const ids = righe.map(r => r.id).filter(Boolean)
  if (!ids.length) return out

  const mie = new Map<string, any>(), entrate = new Map<string, any>()
  // Incassato per tracking (importo_cod della riga nella MIA distinta / in quella in ENTRATA): su un COD
  // parziale è meno del dichiarato. Preferisco l'importo della distinta IN ENTRATA (quanto mi è arrivato);
  // per un detentore — che non ha entrata — vale la sua (quanto gli ha pagato il corriere).
  const codIncassato = new Map<string, number>()
  // CONDIVISIONE (gamba esplosa): le righe-distinta COD puntano alla spedizione ORIGINANTE (una per
  // tracking), mentre la lista mostra la GAMBA del livello che guarda (gamba-ponte, id diverso). La
  // chiave di aggancio e' quindi il TRACKING, non l'id della riga. Raccolgo TUTTE le gambe di ogni
  // tracking e aggancio la distinta per tracking. Per le spedizioni normali (un solo id per tracking)
  // la chiave coincide col tracking stesso e il comportamento e' identico; fallback all'id se manca il tracking.
  const trackings = [...new Set(righe.map(r => r.tracking_number).filter(Boolean) as string[])]
  const trackingByLeg = new Map<string, string>()
  const legIds = new Set<string>(ids)
  for (let i = 0; i < trackings.length; i += 150) {
    const { data: legs } = await adminDb.from('spedizioni')
      .select('id,tracking_number').in('tracking_number', trackings.slice(i, i + 150))
    for (const l of (legs || [])) {
      if ((l as any).tracking_number) trackingByLeg.set((l as any).id, (l as any).tracking_number)
      legIds.add((l as any).id)
    }
  }
  const chiaveDi = (sid: string) => trackingByLeg.get(sid) || sid
  const allIds = [...legIds]
  // Chunk PICCOLI + fetchAll: ogni spedizione ha UNA riga di distinta PER LIVELLO della catena,
  // quindi un chunk grande può superare le 1000 righe (cap PostgREST) e perderne pezzi.
  for (let i = 0; i < allIds.length; i += 150) {
    const rr = await fetchAll(() => adminDb.from('distinte_contrassegni_righe')
      .select('id, importo_cod, spedizione_id, distinte_contrassegni!inner(id,numero,stato,master_id,target_master_id)')
      .in('spedizione_id', allIds.slice(i, i + 150)).order('id', { ascending: true }))
    for (const r of (rr || [])) {
      const d: any = (r as any).distinte_contrassegni
      const sid = (r as any).spedizione_id
      if (!d || !sid) continue
      const k = chiaveDi(sid)
      const inc = Number((r as any).importo_cod) || 0
      // L'entrata (quanto mi è arrivato) vince sulla mia; per il detentore c'è solo la sua.
      if (d.target_master_id === masterId) { entrate.set(k, d); codIncassato.set(k, inc) }
      else if (d.master_id === masterId) { mie.set(k, d); if (!codIncassato.has(k)) codIncassato.set(k, inc) }
    }
  }

  const sorgente = await caricaSorgenteCatena(adminDb)
  const catene = new Map<string, string[]>()
  const catenaDi = (mid: string) => {
    if (!catene.has(mid)) {
      const path: string[] = []
      let cur: string | null = mid
      for (let i = 0; i < 20 && cur; i++) { path.push(cur); cur = (sorgente.padreDi(cur) as string | null) }
      catene.set(mid, path)
    }
    return catene.get(mid)!
  }
  const detentori = new Map<string, string>()
  for (const r of righe) {
    const nome = r.corrieri?.nome_contratto || null
    const partenza = r.master_id || masterId
    const k = partenza + '|' + (nome || '')
    if (!detentori.has(k)) detentori.set(k, (await detentoreContrattoCon(sorgente, partenza, nome)).detentore)
    const detentore = detentori.get(k)!
    const sonoDetentore = detentore === masterId
    // I soldi passano da me solo se il detentore è me o sta SOPRA di me: sul contratto proprio di un
    // sotto-master il corriere paga lui, e a me quel contrassegno non arriva mai.
    const catena = catenaDi(partenza)
    const iMio = catena.indexOf(masterId), iDet = catena.indexOf(detentore)
    const incassoMio = iMio !== -1 && iDet >= iMio
    const chiaveRiga = r.tracking_number || r.id
    const mia = mie.get(chiaveRiga), inEntrata = entrate.get(chiaveRiga)
    const riferimento = sonoDetentore ? mia : inEntrata
    let stato: StatoCodLivello = 'in_attesa'
    if (r.stato_contrassegno === 'annullato') stato = 'annullato'      // reso: non si incasserà a nessun livello
    else if (riferimento) stato = riferimento.stato === 'pagata' ? 'pagato' : 'in_distinta'
    out.set(r.id, {
      stato, sonoDetentore,
      mia: mia ? { id: mia.id, numero: mia.numero, stato: mia.stato } : undefined,
      inEntrata: inEntrata ? { id: inEntrata.id, numero: inEntrata.numero, stato: inEntrata.stato } : undefined,
      // Selezionabile = non è già in una MIA distinta (l'anti-doppio è per livello) e non è un reso.
      // NON si guarda il colore: da quando il colore dice "ho incassato", un contrassegno che ho già
      // messo in distinta resta grigio finché non mi pagano — ma metterlo in una seconda distinta no.
      selezionabile: incassoMio && !mia && stato !== 'annullato',
      incassato: codIncassato.get(chiaveRiga),
    })
  }
  return out
}
