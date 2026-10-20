import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
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
  // SOLO I DUE FLAG PROTETTI (is_super_master, vede_rete_completa: li scrive solo la piattaforma). Prima si
  // usava masterVedeReteCompleta, che e' vero anche per OGNI radice: le DEMO nascono radici isolate, e fino
  // al 20/10/2026 i loro titolari (6, di cui 5 scadute ma col login valido) leggevano perdite e margini di
  // tutta la piattaforma. Escluderle col flag `demo` non basta: quel campo, stando agli script del repo, il
  // titolare puo' riscriverselo da solo. Chi passa oggi: MoovExpress, MULTIEXPRESS, Ecomize Solution ed
  // Ecomize LL, come prima.
  const { data: mio }: { data: any } = await admin.from('masters').select('is_super_master,vede_rete_completa').eq('id', utente.master_id).maybeSingle()
  if (!mio?.is_super_master && !mio?.vede_rete_completa) return { ok: false, status: 403, error: 'Riservato al super master' }
  return { ok: true }
}
