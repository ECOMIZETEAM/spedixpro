import { redirect } from 'next/navigation'
import { puoGestireRete } from '@/lib/permessi'

// Gestione sotto-master: accessibile solo ai master abilitati (gestione_rete).
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  if (!(await puoGestireRete())) redirect('/dashboard/clienti')
  return <>{children}</>
}
