// Un `rif_ordine` a volte e' un IDENTIFICATIVO D'ORDINE affidabile (unico per ordine: Amazon, Temu,
// numero ordine Shopify), a volte e' solo un'ETICHETTA riusata a mano ("AMAZON", "g", "EXP 2",
// "INTIMO"): la stessa parola su ORDINI DIVERSI dello stesso cliente. La differenza vale soldi:
// la deduplica anti-doppione (import e creazione spedizione) puo' agire SOLO sui primi — sui secondi
// bloccherebbe ordini veri e diversi (falso positivo), impedendo spedizioni legittime.
//
// Verificato sui dati veri (19/08/2026): i doppioni reali hanno id Amazon (171-1506000-5669146),
// numeri ordine (#2598) o Temu (PO-...); i falsi positivi hanno "AMAZON"/"g"/"u"/"EXP 2"/"4X24".
export function rifOrdineAffidabile(rif: string | null | undefined): boolean {
  const r = String(rif || '').trim()
  if (r.length < 4) return false                             // "g", "u", "2H1": troppo corti
  if (/^\d{3}-\d{7}-\d{7}$/.test(r)) return true             // Amazon order-id
  if (/^PO-[\d-]{6,}$/i.test(r)) return true                 // Temu
  if (/^#?\d{3,}$/.test(r)) return true                      // numero ordine (Shopify #1234, gestionale)
  if (r.length >= 12 && (r.match(/\d/g) || []).length >= 8) return true  // id lungo pieno di cifre
  return false                                               // "AMAZON", "EXP 2", "4X24", "INTIMO"...
}
