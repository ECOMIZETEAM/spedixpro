import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { masterVedeReteCompleta } from '@/lib/rete-masters'

// Accessi Rete: scorciatoia del VERTICE (root / vede_rete_completa) per entrare in qualunque master
// o cliente della propria rete. Gate piu' stretto di puoGestireRete: qui serve la visibilita'
// COMPLETA, non il solo flag gestione_rete.
export default async function AccessiLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!u?.master_id || (u.ruolo !== 'master' && u.ruolo !== 'admin')) redirect('/dashboard')
  const admin = createAdminSupabase()
  if (!(await masterVedeReteCompleta(admin, u.master_id))) redirect('/dashboard')
  return <>{children}</>
}
