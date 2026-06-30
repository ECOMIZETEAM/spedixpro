import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const parentId = searchParams.get('parent_id')

  if (!parentId) return NextResponse.json({ error: 'parent_id richiesto' }, { status: 400 })

  // Master figli diretti
  const { data: masterFigli } = await supabase
    .from('masters')
    .select('id,nome,email,attivo,created_at')
    .eq('parent_master_id', parentId)
    .order('nome')

  // Clienti diretti di questo master
  const { data: clientiDiretti } = await supabase
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
