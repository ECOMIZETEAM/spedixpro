// SUPPLEMENTO ARRIVATO DOPO I CHILI.
//
// Il fornitore a volte addebita un supplemento fisso (fuori sagoma, non sovrapponibile...) mesi dopo, su un pacco
// che e' gia' stato rettificato per i chili. Sul file del 30/10/2026 di MULTI erano 7: 1UW07WF333479 di PE.DA
// rettificato a spedizioni 2000 il 21/08 per 6,02 €, poi il fuori sagoma addebitato a MULTI il 30/10. Le guardie
// anti-doppio (trg_rettifica_no_doppia_ripesatura nel database e la chiave RIP-<spedizione>-<destinatario> alla
// Conferma) lo vedevano come una seconda rettifica dello stesso pacco e lo fermavano: restava tutto a MULTI.
//
// Una riga cosi' porta SOLO il supplemento: differenza zero, stesso peso prima e dopo (cosi' la guardia del
// database, che guarda le ripesature, la lascia passare), e il nome del supplemento con questo segno in coda.
// Il segno e' nel nome come per la penale BRT: viaggia da solo lungo la catena e chi paga lo legge nel movimento.
// La regola sta qui e basta: Conferma, Carica della rete, Ricalcola, caricamento e pagina la chiedono a questa funzione.
export const SEGNO_TARDIVO = '(arrivato dopo)'

export function eSupplementoTardivo(r: { supplementi_nomi?: string | null; fuori_sagoma?: any; differenza?: any } | null | undefined): boolean {
  if (!r) return false
  // Senza supplemento, o con dei chili dentro, non e' questa riga: una differenza di peso deve passare dalle guardie
  // normali, altrimenti la chiave sua permetterebbe di chiedere due volte gli stessi chili.
  return String(r.supplementi_nomi || '').includes(SEGNO_TARDIVO)
    && (Number(r.fuori_sagoma) || 0) > 0.005
    && Math.abs(Number(r.differenza) || 0) < 0.005
}

export function nomeTardivo(nomi: string[] | string | null | undefined): string {
  const base = (Array.isArray(nomi) ? nomi.join(' + ') : String(nomi || '')).trim() || 'supplemento'
  return base.includes(SEGNO_TARDIVO) ? base : `${base} ${SEGNO_TARDIVO}`
}
