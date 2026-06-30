import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import DashboardLayout from '../components/Layout'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente } = await supabase.from('utenti').select('nome,ruolo').eq('id', user.id).single()
  return (
    <DashboardLayout user={{ nome: utente?.nome || 'Admin', ruolo: utente?.ruolo || 'master' }}>
      {children}
    </DashboardLayout>
  )
}
