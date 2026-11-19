import { fetchAllStretto } from '@/lib/fetch-all'
import { leggiPerBlocchi, pagatoSuAnnullate } from '../comune'

const r2 = (n: number) => Math.round(n * 100) / 100

export type RigaDistinta = { numero: any; data: string; spedizioni: number; annullate: number; totale: number }

// Le distinte del cliente nel periodo, COMPLETE, con il totale di quello che ha pagato.
//
// Prima: una query in fila per ogni distinta (CASALINGHI SICIGNANO: 734 in 30 giorni, 1.666 in 90)
// e l'elenco delle distinte senza pagine, quindi troncato a 1.000 (a 90 giorni le 666 piu' recenti
// sparivano). In piu' le spedizioni annullate entravano a prezzo pieno: NEGOZIO MATTO, ultimi 30
// giorni al 15/10/2026, leggeva 2.820,97 invece di 1.951,09 (157 annullate). Ora le spedizioni si leggono in blocco e l'annullata (rimborsata)
// si conta a parte, a 0 e fuori dal totale — salvo i pacchi annullati e ri-addebitati perche'
// partiti, che valgono quello che il cliente ha pagato (comune.ts, pagatoSuAnnullate).
export async function righeDistinteCliente(db: any, clienteId: string, f: { dal: string | null; al: string | null }): Promise<RigaDistinta[]> {
  const distinte = await fetchAllStretto<any>(() => {
    let q = db.from('distinte').select('id,numero,created_at').eq('cliente_id', clienteId)
    if (f.dal) q = q.gte('created_at', f.dal)
    if (f.al) q = q.lte('created_at', f.al)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true })
  })
  if (!distinte.length) return []

  const speds = await leggiPerBlocchi<any>(distinte.map((d: any) => d.id), (b) => db.from('spedizioni')
    .select('id,distinta_id,costo_totale,stato').eq('cliente_id', clienteId).in('distinta_id', b)
    .order('id', { ascending: true }))
  const pagato = await pagatoSuAnnullate(db, clienteId,
    speds.filter((s: any) => s.stato === 'annullata').map((s: any) => s.id))
  const perDistinta = new Map<string, { n: number; annullate: number; totale: number }>()
  for (const s of speds) {
    const a = perDistinta.get(s.distinta_id) || { n: 0, annullate: 0, totale: 0 }
    a.n++
    if (s.stato === 'annullata') { a.annullate++; a.totale += pagato.get(s.id) || 0 }
    else a.totale += Number(s.costo_totale || 0)
    perDistinta.set(s.distinta_id, a)
  }
  return distinte.map((d: any) => {
    const a = perDistinta.get(d.id) || { n: 0, annullate: 0, totale: 0 }
    return { numero: d.numero, data: d.created_at, spedizioni: a.n, annullate: a.annullate, totale: r2(a.totale) }
  })
}
