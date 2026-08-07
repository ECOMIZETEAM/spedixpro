import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

// Riconosce la piattaforma di provenienza dell'ordine importato dalla riga originale (raw).
export function piattaformaDa(raw: any): 'amazon' | 'shopify' | 'temu' | 'altro' {
  if (!raw || typeof raw !== 'object') return 'altro'
  // Temu PRIMA: il suo export ha colonne inequivocabili (Sconto di Temu, la email "virtuale" di
  // relay, l'ID articolo dell'ordine). Va riconosciuto, se no gli ordini Temu finiscono in "altro"
  // e non escono quando si scarica il tracking per piattaforma.
  if ('sconto_di_temu' in raw || 'email_virtuale' in raw || 'id_articolo_dellordine' in raw) return 'temu'
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

  // Stesse condizioni del file scaricabile (annullate escluse, tiebreaker in paginazione):
  // i numeri a video devono coincidere con quelli del file, altrimenti il cliente non torna.
  const righe = await fetchAll(() => supabase
    .from('ordini_importati')
    .select('id, raw, articoli, spedizioni!inner(created_at, stato, cancellata_il)')
    .eq('cliente_id', utente.cliente_id)
    .eq('stato', 'spedito')
    .is('integrazione_id', null)                 // solo ordini caricati da FILE (non dai negozi collegati)
    .not('spedizione_id', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true }))

  const ANNULLATI = ['annullata', 'annullamento_pending', 'annullamento_manuale']
  // Raggruppo per piattaforma + data di spedizione. Conto ORDINI e RIGHE: Amazon evade per
  // ARTICOLO, quindi un ordine multi-prodotto vale piu' righe nel file. Mostrare solo gli ordini
  // faceva sembrare sbagliato il conteggio di Amazon (113 ordini -> 114 record).
  const mappa = new Map<string, { piattaforma: string; data: string; n: number; righe: number }>()
  const totali: Record<string, number> = { amazon: 0, shopify: 0, altro: 0 }
  for (const r of (righe || [])) {
    const sp: any = (r as any).spedizioni
    if (sp?.cancellata_il || ANNULLATI.includes(String(sp?.stato || ''))) continue
    const piatt = piattaformaDa((r as any).raw)
    const dataSped = (sp?.created_at || '').slice(0, 10) || '—'
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
}
