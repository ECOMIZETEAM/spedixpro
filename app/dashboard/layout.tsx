import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import DashboardLayout from '../components/Layout'
export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente } = await supabase.from('utenti').select('nome,ruolo,master_id').eq('id', user.id).single()
  // Brand del master (logo/nome) da mostrare in alto a sinistra
  let brandLogo: string | null = null
  let brandNome: string | null = null
  if (utente?.master_id) {
    const { data: m } = await supabase.from('masters').select('logo_url,nome').eq('id', utente.master_id).single()
    brandLogo = m?.logo_url || null
    brandNome = m?.nome || null
  }
  return (
    <DashboardLayout user={{ nome: utente?.nome || 'Admin', ruolo: utente?.ruolo || 'master', brandLogo, brandNome }}>
      {children}
    </DashboardLayout>
  )
}
