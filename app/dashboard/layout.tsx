import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import DashboardLayout from '../components/Layout'
import { getPermessiUtente } from '@/lib/permessi'
import AbbonamentoGate from './AbbonamentoGate'
import BannerPiano from '../components/BannerPiano'
import { DialogProvider } from '../components/DialogProvider'

// Mai in cache: dipende dalla sessione. Senza questo Vercel puo' servire una versione resa
// SENZA utente -> sidebar assente al primo accesso (il portale cliente aveva gia' lo stesso
// accorgimento per lo stesso identico motivo).
export const dynamic = 'force-dynamic'
export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente, error: errUtente } = await supabase
    .from('utenti').select('nome,ruolo,master_id,attivo').eq('id', user.id).maybeSingle()
  // Un guasto MOMENTANEO della query non deve buttare fuori nessuno: si distingue l'errore
  // (rete/database non raggiungibile -> si lascia proseguire con permessi minimi) dal caso in cui
  // la riga davvero non esiste.
  if (errUtente) throw new Error('Profilo non leggibile in questo momento, riprova fra poco')
  // Account autenticato ma SENZA riga in `utenti`: senza questo controllo i ripieghi qui sotto
  // (ruolo 'master', isFull true) gli davano il menu amministrativo completo. Ne esistono davvero:
  // si creano quando l'utente nasce in auth ma l'inserimento in `utenti` fallisce a meta'.
  // Stesso trattamento per chi e' stato disattivato dal master: fuori.
  if (!utente || utente.attivo === false) redirect('/api/auth/logout')
  // Permessi effettivi dell'utente (admin/master = tutto; operatore/agente = da Impostazioni Permessi)
  const perm = await getPermessiUtente()
  // Brand del master (logo/nome) da mostrare in alto a sinistra
  let brandLogo: string | null = null
  let brandNome: string | null = null
  let superMaster = false
  if (utente?.master_id) {
    const { data: m } = await supabase.from('masters').select('logo_url,nome,is_super_master').eq('id', utente.master_id).single()
    brandLogo = m?.logo_url || null
    brandNome = m?.nome || null
    superMaster = !!m?.is_super_master
  }
  return (
    <DashboardLayout user={{
      nome: utente?.nome || 'Admin',
      ruolo: utente?.ruolo || 'master',
      brandLogo, brandNome,
      isFull: perm?.isFull ?? true,
      gestioneRete: perm?.gestioneRete ?? false,
      permessi: perm?.permessi || {},
      superMaster,
    }}>
      <DialogProvider>
        {(utente?.ruolo === 'master' || utente?.ruolo === 'admin') && <AbbonamentoGate />}
        <BannerPiano linkUpgrade="/dashboard/abbonamento" />
        {children}
      </DialogProvider>
    </DashboardLayout>
  )
}
