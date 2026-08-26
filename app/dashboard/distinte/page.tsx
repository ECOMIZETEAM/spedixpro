import { redirect } from 'next/navigation'

// Era uno stub "Sezione in arrivo" mai collegato dal menu (la voce Distinte apre le sotto-voci
// Crea/Elenco). Reindirizza all'elenco vero, così un vecchio bookmark su /dashboard/distinte
// non finisce su una pagina finta. (audit #105)
export default function DistintePage() {
  redirect('/dashboard/distinte/elenco')
}
