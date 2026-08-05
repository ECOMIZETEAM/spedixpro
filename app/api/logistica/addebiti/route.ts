import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// Lo storico di cio' che e' stato addebitato per la logistica: serve a rispondere a "questo
// addebito da dove viene?" senza doverlo cercare fra i movimenti.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, u.master_id)
  const { data } = await admin.from('logistica_addebiti')
    .select('id,tipo,mese,importo,descrizione,created_at,clienti(ragione_sociale)')
    .in('master_id', rete.length ? rete : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false }).limit(300)
  return NextResponse.json(data || [])
}
