import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { giornoRoma } from '@/lib/date-roma'
import { piattaformaDa, ordiniSpediti, ANNULLATI } from './ordini-spediti'
import { erroreReport } from '../comune'

export const dynamic = 'force-dynamic'

// Report degli ordini importati DA FILE (non dai negozi collegati) e già SPEDITI:
// raggruppati per piattaforma (Amazon/Shopify) e per data di spedizione, con i conteggi.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  try {
    // Stesse righe del file scaricabile (stessa funzione, stessi doppioni tolti, annullate escluse):
    // i numeri a video devono coincidere con quelli del file, altrimenti il cliente non torna.
    const righeTutte = await ordiniSpediti(supabase, utente.cliente_id, 'id, created_at, stato, cancellata_il')

    // Raggruppo per piattaforma + data di spedizione. Conto ORDINI e RIGHE: Amazon evade per
    // ARTICOLO, quindi un ordine multi-prodotto vale piu' righe nel file. Mostrare solo gli ordini
    // faceva sembrare sbagliato il conteggio di Amazon (113 ordini -> 114 record).
    const mappa = new Map<string, { piattaforma: string; data: string; n: number; righe: number }>()
    const totali: Record<string, number> = { amazon: 0, shopify: 0, temu: 0, altro: 0 }
    for (const r of righeTutte) {
      const sp: any = (r as any).spedizioni
      if (sp?.cancellata_il || ANNULLATI.includes(String(sp?.stato || ''))) continue
      const piatt = piattaformaDa((r as any).raw)
      // Giorno di ROMA: col giorno di Greenwich i pacchi fatti fra mezzanotte e le 2 finivano
      // nella data del giorno prima, e il file di quel giorno non li conteneva.
      const dataSped = sp?.created_at ? giornoRoma(new Date(sp.created_at)) : '—'
      const arts = Array.isArray((r as any).articoli) ? (r as any).articoli.filter((a: any) => a && a.order_item_id) : []
      const nRighe = arts.length || 1
      const key = `${piatt}|${dataSped}`
      if (!mappa.has(key)) mappa.set(key, { piattaforma: piatt, data: dataSped, n: 0, righe: 0 })
      const g = mappa.get(key)!
      g.n++; g.righe += nRighe
      totali[piatt] = (totali[piatt] || 0) + 1
    }

    const gruppi = Array.from(mappa.values()).sort((a, b) => (a.data < b.data ? 1 : -1))
    return NextResponse.json({ gruppi, totali })
  } catch (e: any) {
    return erroreReport(e)
  }
}
