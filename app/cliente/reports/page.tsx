import { redirect } from 'next/navigation'

// Era un segnaposto "Sezione in arrivo": i report del cliente vivono nelle sotto-voci del menu.
// Chi arriva qui (indirizzo scritto a mano, segnalibro) va al primo report invece che a una pagina vuota.
export default function ReportPage() {
  redirect('/cliente/reports/spedizioni')
}
