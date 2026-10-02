import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { vedeLaRete } from '@/lib/ruoli'

export async function GET(req: NextRequest, context: any) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // Il dettaglio di una distinta di resi e' roba del portale master: `master_id` da solo lo aprirebbe
  // anche alle 1.700 utenze cliente, che vedrebbero le LDV e i costi degli altri clienti del master.
  if (!vedeLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await context.params
  const { data } = await supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .eq('id', id)
    .single()
  return NextResponse.json(data || null)
}