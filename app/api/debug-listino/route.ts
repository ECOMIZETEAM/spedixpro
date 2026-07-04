import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'non autenticato' })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()

  // master_id: se sono un cliente lo prendo da utente, altrimenti sono io il master
  const masterId = utente?.master_id || user.id

  // tutti i corrieri del master
  const { data: corrieri } = await supabase.from('corrieri').select('id,nome_contratto,tipo').eq('master_id', masterId)

  const out: any[] = []
  for (const c of (corrieri || [])) {
    const { data: zone } = await supabase.from('zone').select('id,nome').eq('master_id', masterId).eq('corriere_id', c.id).order('nome')
    out.push({
      corriere: c.nome_contratto,
      tipo: c.tipo,
      corriere_id: c.id,
      numero_zone: (zone || []).length,
      zone: (zone || []).map((z: any) => z.nome),
    })
  }

  return NextResponse.json({ masterId, sono_cliente: !!utente?.cliente_id, contratti: out }, { status: 200 })
}