import { redirect } from 'next/navigation'

// La vecchia pagina "Condivisione contratti" non esiste più: il flusso vive ora su Elenco Master
// ("Collega master tramite codice") e su Elenco Clienti (il master collegato si gestisce dalla sua
// scheda). Redirect per non lasciare 404 ai vecchi link/bookmark.
export default function CondivisioniRimossa() {
  redirect('/dashboard/clienti/master')
}
