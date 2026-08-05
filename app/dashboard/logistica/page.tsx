import { redirect } from 'next/navigation'

// La Logistica non ha una pagina unica: aprendola si va sul gesto piu' frequente, il carico.
export default function LogisticaIndex() {
  redirect('/dashboard/logistica/carico')
}
