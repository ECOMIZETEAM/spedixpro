import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })

  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const admin = createAdminSupabase()

  // Ogni master vede la gerarchia SOLO da sé stesso in giù (i suoi discendenti):
  // il vertice della vista è il master corrente, mai i livelli superiori.
  const rootId = utente.master_id

  const { data: allMasters } = await admin
    .from('masters')
    .select('id,nome,email,parent_master_id,attivo')
    .order('nome')

  const { data: allClienti } = await admin
    .from('clienti')
    .select('id,ragione_sociale,email,master_id,attivo,promosso_a_master_id')
    .order('ragione_sociale')

  function isDescendant(masterId: string, ancestorId: string, masters: any[]): boolean {
    let curr = masterId
    for (let i = 0; i < 20; i++) {
      if (curr === ancestorId) return true
      const m = masters.find(x => x.id === curr)
      if (!m?.parent_master_id) return false
      curr = m.parent_master_id
    }
    return false
  }

  // Rete privata: chi non ha visibilità completa vede solo sé + i figli DIRETTI (e solo i propri clienti),
  // non l'intero albero coi clienti dei sotto-master.
  const { masterVedeReteCompleta } = await import('@/lib/rete-masters')
  const completa = await masterVedeReteCompleta(admin, rootId)
  const mastersAlbero = completa
    ? (allMasters || []).filter(m => m.id === rootId || isDescendant(m.id, rootId, allMasters || []))
    : (allMasters || []).filter(m => m.id === rootId || m.parent_master_id === rootId)
  const idsAlbero = new Set(mastersAlbero.map(m => m.id))
  const clientiAlbero = (allClienti || []).filter(c =>
    (completa ? idsAlbero.has(c.master_id) : c.master_id === rootId) && !c.promosso_a_master_id)

  return NextResponse.json({
    rootId,
    masters: mastersAlbero,
    clienti: clientiAlbero,
  })
}
