import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()

  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { ids } = await req.json()
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'Nessun ordine selezionato' }, { status: 400 })
  }

  // Isolamento: elimina solo righe del cliente in sessione anche se arrivano id altrui.
  // Gli ordini possono stare in ordini_ecommerce (integrazioni: eBay/Shopify/…) o ordini_importati
  // (import CSV): provo entrambe e conto quelli DAVVERO eliminati (prima diceva sempre "eliminati"
  // ma cancellava solo da ordini_importati -> gli ordini eBay restavano).
  const { data: delEcom, error: e1 } = await supabase.from('ordini_ecommerce')
    .delete().eq('cliente_id', utente.cliente_id).in('id', ids).select('id')
  const { data: delImp, error: e2 } = await supabase.from('ordini_importati')
    .delete().eq('cliente_id', utente.cliente_id).in('id', ids).select('id')
  if (e1 && e2) return NextResponse.json({ error: (e1?.message || e2?.message) }, { status: 500 })
  const eliminati = (delEcom?.length || 0) + (delImp?.length || 0)
  return NextResponse.json({ ok: eliminati > 0, eliminati })
}
