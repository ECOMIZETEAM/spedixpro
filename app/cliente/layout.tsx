import { createServerSupabase } from '@/lib/supabase'
import ClienteShell from './ClienteShell'

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
  const { data: utente } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).single()
  if (!utente?.cliente_id) return <>{children}</>
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale,credito').eq('id', utente.cliente_id).single()

  return (
    <ClienteShell cliente={{ ragione_sociale: cliente?.ragione_sociale, credito: cliente?.credito }}>
      {children}
    </ClienteShell>
  )
}
