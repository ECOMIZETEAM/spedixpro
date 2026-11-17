// Prezzo di vendita per SMS: 1.000 SMS = 100 € → 0,10 €/SMS (senza IVA — società UK, reverse charge).
// Lo compra CHI manda gli SMS (il cliente per sé, o il master per i suoi clienti), pagando su Stripe.
//
// Sta in un file a parte perché serve anche alle pagine (quanti SMS restano, se l'invio può partire):
// lib/sms.ts parla col gateway e col database con la chiave di servizio, e non va trascinato nel
// codice che arriva al browser.
export const COSTO_SMS_EUR = 0.10
