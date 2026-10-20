import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { masterVedeReteCompleta } from '@/lib/rete-masters'
import { gestisceLaRete } from '@/lib/ruoli'

// Gate unico dei controlli della Centrale di Controllo: SOLO super master (qui si legge tutta la rete
// con la chiave di servizio e i costi a valle non devono uscire a un master qualunque).
export async function verificaSuperMaster(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Non autenticato' }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // Il ruolo, non il solo master_id: ce l'hanno anche clienti, agenti e autisti. Bastava appartenere a un
  // master con la rete completa (MoovExpress, Ecomize LL, Ecomize Solution, MULTIEXPRESS) per leggere
  // perdite e margini di tutta la rete: in ott 2026 erano aperte a 7 agenti e 344 clienti.
  if (!utente?.master_id || !gestisceLaRete(utente)) return { ok: false, status: 403, error: 'Non autorizzato' }
  const admin = createAdminSupabase()
  if (!(await masterVedeReteCompleta(admin, utente.master_id))) return { ok: false, status: 403, error: 'Riservato al super master' }
  return { ok: true }
}
