import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Risale dal master corrente verso l'alto per trovare il root, poi scarica TUTTO l'albero sotto il root
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  // Trova il master root risalendo l'albero
  let currentId = utente.master_id
  let rootId = currentId
  for (let i = 0; i < 20; i++) { // limite di sicurezza per evitare loop infiniti
    const { data: m } = await supabase.from('masters').select('parent_master_id').eq('id', currentId).single()
    if (!m?.parent_master_id) { rootId = currentId; break }
    currentId = m.parent_master_id
    rootId = currentId
  }

  // Prendi TUTTI i masters (sono pochi in totale, va bene scaricarli tutti e filtrare in memoria)
  const { data: allMasters } = await supabase
    .from('masters')
    .select('id,nome,email,parent_master_id,attivo')
    .order('nome')

  // Prendi TUTTI i clienti
  const { data: allClienti } = await supabase
    .from('clienti')
    .select('id,ragione_sociale,email,master_id,attivo,promosso_a_master_id')
    .order('ragione_sociale')

  // Filtra solo quelli che discendono dal root (incluso il root)
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

  const mastersAlbero = (allMasters || []).filter(m => m.id === rootId || isDescendant(m.id, rootId, allMasters || []))
  const idsAlbero = new Set(mastersAlbero.map(m => m.id))
  const clientiAlbero = (allClienti || []).filter(c => idsAlbero.has(c.master_id) && !c.promosso_a_master_id)

  return NextResponse.json({
    rootId,
    masters: mastersAlbero,
    clienti: clientiAlbero,
  })
}
