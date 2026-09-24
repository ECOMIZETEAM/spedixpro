import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

/* Le integrazioni RISERVATE autorizzate al master corrente (es. 'dielle' per LOGIXIA). Serve alla pagina
 * Corrieri per mostrare nel menu "Aggiungi" solo i provider che quel master può usare. La difesa vera è
 * comunque server-side nell'azione salvaCorriere; qui è per non mostrare l'opzione a chi non deve vederla. */
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ riservate: [] })
  const { data: u } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!u?.master_id) return NextResponse.json({ riservate: [] })
  const { data: m } = await createAdminSupabase().from('masters').select('integrazioni_riservate').eq('id', u.master_id).maybeSingle()
  const riservate = Array.isArray((m as any)?.integrazioni_riservate) ? (m as any).integrazioni_riservate : []
  return NextResponse.json({ riservate })
}
