import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { masterVedeReteCompleta } from '@/lib/rete-masters'

// Gate unico dei controlli della Centrale di Controllo: SOLO super master (qui si legge tutta la rete
// con la chiave di servizio e i costi a valle non devono uscire a un master qualunque).
export async function verificaSuperMaster(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Non autenticato' }
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return { ok: false, status: 403, error: 'Non autorizzato' }
  const admin = createAdminSupabase()
  if (!(await masterVedeReteCompleta(admin, utente.master_id))) return { ok: false, status: 403, error: 'Riservato al super master' }
  return { ok: true }
}
