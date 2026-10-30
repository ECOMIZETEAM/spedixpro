import { fetchAllStretto } from '@/lib/fetch-all'
import { giornoRoma } from '@/lib/date-roma'
import { marchioCorriere, senzaNomiFornitori } from '@/lib/corriere-logo'
import { leggiPerBlocchi } from '../comune'

const r2 = (n: number) => Math.round(n * 100) / 100

export type RigaRettifica = {
  numero: string
  data: string                    // giorno di Roma dell'ultimo movimento di rettifica del periodo
  corriere: string                // marchio pubblico, mai il fornitore tecnico
  dettaglio: boolean              // false = nessuna riga di ripesatura: si mostra la descrizione
  descrizione: string
  pesoDichiarato: number | null
  pesoVolDichiarato: number | null
  pesoReale: number | null
  pesoVolReale: number | null
  costoIniziale: number | null
  costoFinale: number | null
  differenza: number              // addebito positivo, accredito negativo
}

// LE RETTIFICHE DEL CLIENTE SONO I SUOI MOVIMENTI DI RETTIFICA, non la riga della spedizione.
//
// Prima il report prendeva le spedizioni del periodo e usava `costo_totale` come "costo iniziale".
// Ma la conferma della rettifica RISCRIVE costo_totale e peso_fatturato (app/api/rettifiche,
// spedizioniDaAggiornare): il cliente leggeva come iniziale il costo gia' rettificato e come finale
// la rettifica contata due volte. FUTURAL, 3UW1UHA284414: pagato 5,11 + 4,09 = 9,20, peso dichiarato
// 1 kg; il report diceva 9,20 → 13,29 e 13,65 kg. Negli ultimi 30 giorni al 15/10/2026 FUTURAL
// leggeva 111 righe, 884,98 → 1.185,12 (contate giuste: 584,84 → 884,98), mentre le rettifiche
// addebitate nel periodo erano 989 per 2.441,32 €. In piu': si fermava alle prime 1.000 spedizioni
// del periodo e filtrava per data della SPEDIZIONE invece che dell'addebito (settembre, tutti i
// clienti: 13.069 righe per 41.263,18 € contro 20.227 rettifiche addebitate per 61.752,10 €), con
// Math.abs trasformava gli accrediti in addebiti (29 righe ad agosto) e teneva le rettifiche poi
// rimborsate con l'annullo.
//
// Ora: righe = movimenti 'rettifica' del cliente su una spedizione, nel periodo per data del
// MOVIMENTO, netti per spedizione; fuori le spedizioni il cui addebito e' stato stornato da un
// 'rimborso' (annullo: lib/annullaSpedizione storna spedizione E rettifiche). I numeri di dettaglio
// (costi e pesi prima/dopo) vengono dalla riga CONFERMATA di `rettifiche` di questo cliente, l'ultima
// per data se sono piu' d'una. Mai `costo_fornitore`: e' il costo del master.
// Le correzioni del credito senza spedizione (refusi, compensazioni) non sono rettifiche di un pacco
// e restano nella Lista movimenti.
export async function righeRettificheCliente(
  db: any, adminDb: any, clienteId: string,
  f: { dal: string | null; al: string | null; vettore?: string | null },
): Promise<RigaRettifica[]> {
  const mov = await fetchAllStretto<any>(() => {
    let q = db.from('movimenti')
      .select('id,importo,spedizione_id,descrizione,riferimento,created_at')
      .eq('cliente_id', clienteId).eq('tipo', 'rettifica').not('spedizione_id', 'is', null)
    if (f.dal) q = q.gte('created_at', f.dal)
    if (f.al) q = q.lte('created_at', f.al)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true })
  })

  type Acc = { netto: number; ultima: string; descrizioni: string[]; riferimento: string }
  const perSped = new Map<string, Acc>()
  for (const m of mov) {
    const a = perSped.get(m.spedizione_id) || { netto: 0, ultima: '', descrizioni: [], riferimento: '' }
    a.netto += Number(m.importo || 0)
    if (String(m.created_at) > a.ultima) a.ultima = String(m.created_at)
    const d = senzaNomiFornitori(m.descrizione)
    if (d && !a.descrizioni.includes(d)) a.descrizioni.push(d)
    if (!a.riferimento && m.riferimento) a.riferimento = String(m.riferimento)
    perSped.set(m.spedizione_id, a)
  }
  const ids = Array.from(perSped.keys())
  if (!ids.length) return []

  // Annullate dopo la rettifica: il rimborso le ha gia' restituite al cliente.
  const rimborsi = await leggiPerBlocchi<any>(ids, (b) => db.from('movimenti')
    .select('id,spedizione_id').eq('cliente_id', clienteId).eq('tipo', 'rimborso').in('spedizione_id', b)
    .order('spedizione_id', { ascending: true }).order('id', { ascending: true }))
  const stornate = new Set(rimborsi.map((r: any) => r.spedizione_id))

  // Numero e contratto della spedizione, con le regole di lettura del cliente.
  const speds = await leggiPerBlocchi<any>(ids, (b) => db.from('spedizioni')
    .select('id,numero,corrieri(nome_contratto)').in('id', b).order('id', { ascending: true }))
  const spedDi = new Map(speds.map((s: any) => [s.id, s]))

  // Chiave di servizio, RISTRETTA alle righe di QUESTO cliente sulle spedizioni dei SUOI movimenti, e
  // senza costo_fornitore: le colonne si scelgono qui. La regola di lettura del database (al 30/10/2026)
  // lascerebbe al cliente le sue righe con TUTTE le colonne, costo del fornitore compreso.
  const rett = await leggiPerBlocchi<any>(ids, (b) => adminDb.from('rettifiche')
    .select('id,spedizione_id,numero_spedizione,costo_iniziale,costo_finale,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,created_at')
    .eq('cliente_id', clienteId).eq('confermata', true).in('spedizione_id', b)
    .order('created_at', { ascending: true }).order('id', { ascending: true }))
  // Piu' righe confermate sulla stessa spedizione (es. 3UW1WLJ008099, ripesata due volte): vale
  // l'ultima per data, che e' quella del prezzo rimasto.
  const rettDi = new Map<string, any>()
  for (const r of rett) rettDi.set(r.spedizione_id, r)

  const num = (v: any) => (v === null || v === undefined ? null : Number(v))
  const righe: RigaRettifica[] = []
  for (const [id, a] of perSped) {
    if (stornate.has(id)) continue
    const netto = r2(a.netto)
    // Addebito e storno che si annullano nel periodo: nessun soldo mosso, nessuna riga.
    if (Math.abs(netto) < 0.005) continue
    const s: any = spedDi.get(id)
    const corriere = marchioCorriere(s?.corrieri?.nome_contratto || '')
    if (f.vettore && corriere !== f.vettore) continue
    const r = rettDi.get(id)
    righe.push({
      numero: s?.numero || r?.numero_spedizione || a.riferimento || '',
      data: giornoRoma(new Date(a.ultima)),
      corriere,
      dettaglio: !!r,
      descrizione: a.descrizioni.join(' · '),
      pesoDichiarato: r ? num(r.peso_iniziale) : null,
      pesoVolDichiarato: r ? num(r.peso_volume_iniziale) : null,
      pesoReale: r ? num(r.peso_reale) : null,
      pesoVolReale: r ? num(r.peso_volume_reale) : null,
      costoIniziale: r ? num(r.costo_iniziale) : null,
      costoFinale: r ? num(r.costo_finale) : null,
      // Il segno resta: l'addebito (movimento negativo) esce positivo, l'ACCREDITO esce negativo e
      // abbassa il totale invece di gonfiarlo.
      differenza: r2(-netto),
    })
  }
  righe.sort((x, y) => (x.data === y.data ? x.numero.localeCompare(y.numero) : x.data < y.data ? -1 : 1))
  return righe
}
