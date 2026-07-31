import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const parentId = searchParams.get('parent_id')
  if (!parentId) return NextResponse.json({ error: 'parent_id richiesto' }, { status: 400 })

  const admin = createAdminSupabase()

  // IL parent_id VA VERIFICATO. Arriva dal browser e qui sotto si legge con il client admin, che
  // scavalca la RLS: senza questo controllo bastava passare l'id del PROPRIO PADRE — che il
  // portale gia' consegna al browser in /api/master/root — per farsi dare l'elenco completo dei
  // clienti e dei sotto-master del padre, cioe' l'anagrafica dei master FRATELLI, concorrenti
  // diretti sotto lo stesso capo, nome per nome e con l'email di accesso.
  // Si puo' guardare solo dentro il proprio sotto-albero: se stessi e la propria discendenza.
  const { data: chi } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const mio = chi?.master_id
  if (!mio) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (parentId !== mio) {
    const { eDiscendente } = await import('@/lib/rete-masters')
    if (!(await eDiscendente(admin, parentId, mio))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }

  const { data: masterFigli } = await admin
    .from('masters')
    .select('id,nome,email,attivo,created_at')
    .eq('parent_master_id', parentId)
    .order('nome')

  const { data: clientiDiretti } = await admin
    .from('clienti')
    .select('id,ragione_sociale,email,attivo')
    .eq('master_id', parentId)
    .is('promosso_a_master_id', null)
    .order('ragione_sociale')

  return NextResponse.json({
    masters: masterFigli || [],
    clienti: clientiDiretti || [],
  })
}
