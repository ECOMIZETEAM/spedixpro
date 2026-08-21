import { NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'

// MULTIEXPRESS = detentore PDB: le rettifiche nascono a questo livello (come quando carica il file).
export const MASTER_DETENTORE_PDB = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'

// Chi puo' chiamare gli endpoint dell'harvester continuo:
//  - lo SCRIPT locale (sul Mac di Lorenzo, rete italiana) con Bearer <token> = onetracking_sessione.token;
//  - oppure la sessione del super-master MULTIEXPRESS dalla UI.
// Poste blocca gli IP di Vercel, per questo la fetch a OneTracking la fa lo script locale e MoovExpress
// riceve solo il ripesato: il cookie OneTracking non passa mai da qui.
export async function autorizzaHarvester(req: NextRequest, admin: any): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (m) {
    const { data } = await admin.from('onetracking_sessione').select('token').eq('id', 1).maybeSingle()
    if ((data as any)?.token && m[1].trim() === String((data as any).token)) return true
  }
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  return gestisceLaRete(u as any) && (u as any)?.master_id === MASTER_DETENTORE_PDB
}
