import { EMAIL_PER_CORRIERE } from '@/lib/spediamopro'

// QUALE EMAIL VEDE IL FORNITORE.
//
// Regola generale (vedi lib/spediamopro, EMAIL_PER_CORRIERE): ai provider NON vanno le email vere di
// mittente e destinatario, ma una email di servizio. Serve a non far arrivare al cliente finale le
// notifiche del fornitore — compreso il link di riprogrammazione della consegna, che gli farebbe
// spostare il pacco scavalcandoci. Gli avvisi al destinatario li mandiamo noi, col nostro marchio.
//
// ECCEZIONI, decise dall'owner, contratto per contratto. Su questi servizi gli avvisi del corriere
// DEVONO arrivare a mittente e destinatario, quindi gli si mandano le email vere:
//  - tutti i contratti Crono di Poste: "Poste CRONOBS", "Poste CRONOBM", "POSTE CRONO" (2-3/10/2026).
// Il nome si confronta normalizzato (senza spazi, maiuscole ignorate) perche' ogni master ha la SUA
// riga `corrieri` per lo stesso contratto e i nomi girano con spazi diversi ("Poste CRONOBS",
// "POSTE CRONO BS"): lo stesso criterio di lib/contratto-per-nome.
const CONTRATTI_EMAIL_VERE = [/crono/];

export function emailVereAlCorriere(nomeContratto?: string | null): boolean {
  const n = String(nomeContratto || '').toLowerCase().replace(/\s+/g, '')
  return CONTRATTI_EMAIL_VERE.some(r => r.test(n))
}

// L'email da mettere nel payload del fornitore: quella vera sui contratti dell'elenco (se c'e' ed e'
// valida), altrimenti quella di servizio. Senza una email valida NON si manda niente di inventato: il
// provider rifiuta la creazione con 422 su un indirizzo malformato.
export function emailAlCorriere(nomeContratto: string | null | undefined, emailVera: any): string {
  const e = String(emailVera ?? '').trim()
  if (emailVereAlCorriere(nomeContratto) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e.substring(0, 50)
  return EMAIL_PER_CORRIERE
}
