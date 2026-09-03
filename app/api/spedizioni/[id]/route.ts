import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Dettaglio "pesante" di UNA spedizione: colli_dettaglio (blob escluso da SPED_COLS della lista) + pesi
// e misure. Serve al modale dettaglio (mostrare i colli di un MULTICOLLO, che la lista non porta) e alla
// correzione peso/misure multicollo. RLS: il client dell'utente vede solo le spedizioni del suo tenant.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data, error } = await supabase.from('spedizioni')
    .select('id,colli,colli_dettaglio,peso_reale,peso_volume,peso_fatturato,lunghezza,larghezza,altezza')
    .eq('id', id).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  return NextResponse.json(data)
}
