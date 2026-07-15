import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

// Riconosce la piattaforma di provenienza dell'ordine importato dalla riga originale (raw).
export function piattaformaDa(raw: any): 'amazon' | 'shopify' | 'altro' {
  if (!raw || typeof raw !== 'object') return 'altro'
  if ('orderitemid' in raw || 'order_item_id' in raw || 'amazonorderid' in raw) return 'amazon'
  if ('lineitem_name' in raw || 'financial_status' in raw || 'shipping_name' in raw || 'shipping_zip' in raw) return 'shopify'
  return 'altro'
}

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

  const righe = await fetchAll(() => supabase
    .from('ordini_importati')
    .select('id, raw, spedizioni!inner(created_at)')
    .eq('cliente_id', utente.cliente_id)
    .eq('stato', 'spedito')
    .is('integrazione_id', null)                 // solo ordini caricati da FILE (non dai negozi collegati)
    .not('spedizione_id', 'is', null)
    .order('created_at', { ascending: false }))

  // Raggruppo per piattaforma + data di spedizione
  const mappa = new Map<string, { piattaforma: string; data: string; n: number }>()
  const totali: Record<string, number> = { amazon: 0, shopify: 0, altro: 0 }
  for (const r of (righe || [])) {
    const piatt = piattaformaDa((r as any).raw)
    const sp: any = (r as any).spedizioni
    const dataSped = (sp?.created_at || '').slice(0, 10) || '—'
    const key = `${piatt}|${dataSped}`
    if (!mappa.has(key)) mappa.set(key, { piattaforma: piatt, data: dataSped, n: 0 })
    mappa.get(key)!.n++
    totali[piatt] = (totali[piatt] || 0) + 1
  }

  const gruppi = Array.from(mappa.values()).sort((a, b) => (a.data < b.data ? 1 : -1))
  return NextResponse.json({ gruppi, totali })
}
