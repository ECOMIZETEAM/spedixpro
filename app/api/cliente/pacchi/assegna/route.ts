import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Assegna in BLOCCO uno o più SKU a un pacco predefinito (aggiunge gli SKU alla lista `sku` del
// pacco, senza duplicati). Serve al Catalogo articoli per collegare velocemente gli articoli a un
// pacco (misure+peso), invece di scriverli a mano nel pacco uno alla volta. Con paccoId vuoto/null
// RIMUOVE gli SKU da tutti i pacchi (dis-associa).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!u?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const paccoId = b.paccoId || null
  const skus: string[] = Array.isArray(b.skus) ? b.skus.map((s: any) => String(s || '').trim()).filter(Boolean) : []
  if (!skus.length) return NextResponse.json({ error: 'Nessuno SKU da assegnare' }, { status: 400 })
  const skusLower = new Set(skus.map((s) => s.toLowerCase()))
  const split = (s: any) => String(s || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)

  // Carico TUTTI i pacchi del cliente: tolgo gli SKU dai pacchi diversi da quello scelto (un articolo
  // sta in UN pacco solo) e li aggiungo a quello scelto.
  const { data: pacchi } = await supabase.from('pacchi_predefiniti').select('id,sku').eq('cliente_id', u.cliente_id)
  for (const p of (pacchi || [])) {
    const attuali = split((p as any).sku)
    if ((p as any).id === paccoId) {
      // aggiungo i nuovi mantenendo gli esistenti (dedup case-insensitive)
      const visti = new Set(attuali.map((x) => x.toLowerCase()))
      for (const s of skus) if (!visti.has(s.toLowerCase())) { attuali.push(s); visti.add(s.toLowerCase()) }
      await supabase.from('pacchi_predefiniti').update({ sku: attuali.join(', ') || null }).eq('id', (p as any).id).eq('cliente_id', u.cliente_id)
    } else {
      // rimuovo dagli ALTRI pacchi gli SKU che sto (ri)assegnando
      const rimasti = attuali.filter((x) => !skusLower.has(x.toLowerCase()))
      if (rimasti.length !== attuali.length) {
        await supabase.from('pacchi_predefiniti').update({ sku: rimasti.join(', ') || null }).eq('id', (p as any).id).eq('cliente_id', u.cliente_id)
      }
    }
  }
  return NextResponse.json({ ok: true, assegnati: skus.length })
}
