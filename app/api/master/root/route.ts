import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: master } = await admin
    .from('masters')
    .select('id,nome,email,is_super_master,parent_master_id')
    .eq('id', utente.master_id)
    .single()

  // CHI STA SOPRA NON SI DICE A CHI NON GESTISCE LA RETE. A qualunque ruolo uscivano l'id del padre del
  // proprio master e il flag del super master: al cliente dicevano che sopra c'e' qualcuno, ed erano
  // l'innesco per chiedere a /api/master/figli l'elenco dei fratelli. L'unica pagina che legge questa
  // rotta (Elenco Master, solo staff) usa id e nome; agli altri ruoli si da' questo e basta.
  if (!gestisceLaRete(utente)) return NextResponse.json(master ? { id: (master as any).id, nome: (master as any).nome } : {})

  return NextResponse.json(master || {})
}
