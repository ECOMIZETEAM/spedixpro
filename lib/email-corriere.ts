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

// L'email da mettere nel payload del fornitore. Sui contratti dell'elenco: quella vera se c'e' ed e'
// valida, altrimenti NESSUNA (undefined: JSON.stringify toglie il campo).
//
// Perche' nessuna e non quella di servizio: fino al 17/11/2026 qui ripiegava su EMAIL_PER_CORRIERE, e
// sul pannello del fornitore il destinatario risultava con l'email di MULTIEXPRESS. MULTI se n'e'
// accorto e Lorenzo ha deciso: su Crono passa l'email del destinatario vero, mai la nostra. In 14
// giorni erano 179 Crono su 624 senza email del destinatario (QUICK 85 su 89, VTS 59 su 61) e 46
// senza quella del mittente (VTS): tutte uscite col nostro indirizzo.
// Il fornitore la accetta senza: provato il 17/11 riproducendo una Crono BS vera di VTS senza nessuna
// delle due email → creata (HTTP 200) e annullata subito.
// Una email piu' lunga di 50 caratteri non si tronca: troncata e' un indirizzo diverso, non il suo.
export function emailAlCorriere(nomeContratto: string | null | undefined, emailVera: any): string | undefined {
  if (!emailVereAlCorriere(nomeContratto)) return EMAIL_PER_CORRIERE
  const e = String(emailVera ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 50 ? e : undefined
}
