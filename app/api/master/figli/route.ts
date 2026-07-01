import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const parentId = searchParams.get('parent_id')
  if (!parentId) return NextResponse.json({ error: 'parent_id richiesto' }, { status: 400 })

  const admin = createAdminSupabase()

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
