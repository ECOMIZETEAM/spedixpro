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
}

type RigaSped = {
  id: string
  master_id?: string | null
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
  // Chunk PICCOLI + fetchAll: ogni spedizione ha UNA riga di distinta PER LIVELLO della catena,
  // quindi un chunk grande può superare le 1000 righe (cap PostgREST) e perderne pezzi.
  for (let i = 0; i < ids.length; i += 150) {
    const rr = await fetchAll(() => adminDb.from('distinte_contrassegni_righe')
      .select('id, spedizione_id, distinte_contrassegni!inner(id,numero,stato,master_id,target_master_id)')
      .in('spedizione_id', ids.slice(i, i + 150)).order('id', { ascending: true }))
    for (const r of (rr || [])) {
      const d: any = (r as any).distinte_contrassegni
      const sid = (r as any).spedizione_id
      if (!d || !sid) continue
      if (d.target_master_id === masterId) entrate.set(sid, d)
      else if (d.master_id === masterId) mie.set(sid, d)
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
    const mia = mie.get(r.id), inEntrata = entrate.get(r.id)
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
    })
  }
  return out
}
