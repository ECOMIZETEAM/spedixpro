import { redirect } from 'next/navigation'

// Gli autisti e le consegne vivono dentro il Circuito interno, insieme alle scansioni che le
// producono: sono lo stesso mestiere, e tenerne una copia qui vorrebbe dire due pagine da
// aggiornare ogni volta. Questa voce resta perche' e' dove la gente li cerca.
export default function AutistiPage() {
  redirect('/dashboard/tracking?tab=autisti')
}
