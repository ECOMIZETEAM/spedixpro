import { redirect } from 'next/navigation'

// Era uno stub "Sezione in arrivo" mentre la feature vive nelle sotto-voci (Aggiungi Spesa / Storia).
// Il menu 'Consumabili' ha href su questa pagina: reindirizza alla Storia vera invece di mostrare
// un placeholder. (audit #110)
export default function ConsumabiliPage() {
  redirect('/dashboard/consumabili/storia')
}
