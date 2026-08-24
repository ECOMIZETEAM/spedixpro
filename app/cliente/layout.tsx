import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import ClienteShell from './ClienteShell'
import BannerPiano from '../components/BannerPiano'
import AvvisoApi from './AvvisoApi'
import { DialogProvider } from '../components/DialogProvider'

// Mai in cache: dipende dalla sessione (senza questo, Vercel può servire una
// versione statica "senza utente" → sidebar assente).
export const dynamic = 'force-dynamic'

export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  // Se non loggato, mostra solo il contenuto (es. la pagina di login /cliente) SENZA
  // reindirizzare: il layout avvolge anche il login, e un redirect qui creerebbe un loop.
  // Le pagine interne restano protette dal middleware.
  if (!user) return <>{children}</>
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id,ruolo,attivo').eq('id', user.id).maybeSingle()
  if (!utente?.cliente_id) return <>{children}</>
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale,credito,attivo').eq('id', utente.cliente_id).maybeSingle()
  // Disattivare un cliente non aveva effetto su chi era GIA' dentro: qui non si controllava mai
  // `attivo`, quindi restava operativo finche' non chiudeva la sessione (e col recupero password
  // rientrava pure). Ora la disattivazione ha effetto alla prima pagina che apre.
  if (utente.attivo === false || cliente?.attivo === false) redirect('/api/auth/logout')

  // WHITE-LABEL: il cliente vede il marchio del SUO master (logo + nome), non "MoovExpress" fisso.
  // Stessa fonte del portale master (masters.logo_url/nome del master diretto); fallback a MoovExpress
  // se il master non ha caricato un logo/nome.
  let brandLogo: string | null = null, brandNome: string | null = null
  if (utente.master_id) {
    const { data: m } = await supabase.from('masters').select('logo_url,nome').eq('id', utente.master_id).maybeSingle()
    brandLogo = m?.logo_url || null
    brandNome = m?.nome || null
  }

  return (
    <ClienteShell cliente={{ ragione_sociale: cliente?.ragione_sociale, credito: cliente?.credito }} brandLogo={brandLogo} brandNome={brandNome}>
      <DialogProvider><AvvisoApi brandLogo={brandLogo} brandNome={brandNome} /><BannerPiano />{children}</DialogProvider>
    </ClienteShell>
  )
}
