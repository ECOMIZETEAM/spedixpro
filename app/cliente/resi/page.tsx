import { redirect } from 'next/navigation'

// Era uno stub "Sezione in arrivo" orfano: il menu Resi punta già a /cliente/resi/distinte.
// Reindirizza lì, così un vecchio link a /cliente/resi non mostra una pagina finta. (audit #107)
export default function ResiClientePage() {
  redirect('/cliente/resi/distinte')
}
