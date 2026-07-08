import { redirect } from 'next/navigation'
import { puoGestireRete } from '@/lib/permessi'

// Gerarchia rete: accessibile solo ai master abilitati (gestione_rete).
export default async function GerarchiaLayout({ children }: { children: React.ReactNode }) {
  if (!(await puoGestireRete())) redirect('/dashboard/clienti')
  return <>{children}</>
}
