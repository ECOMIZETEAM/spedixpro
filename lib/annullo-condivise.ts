import { annullaSpedizioneSulCorriere, rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'
import { risolviGambeSpedizione } from '@/lib/condivisione-catena'

// Stati in cui il pacco e' gia' in mano al corriere, o oltre. Per Poste "spedita" e' la presa in carico
// (lib/tracking-poste.ts): da li' in poi un annullo fatto solo sul portale rimborserebbe un pacco che il
// corriere ha preso e fattura.
const IN_MANO_AL_CORRIERE = ['spedita', 'in_transito', 'in_consegna', 'in_giacenza', 'consegnata', 'reso_mittente', 'non_consegnato']

// Tipi del contratto del DETENTORE su cui l'annullo dopo le 48 ore si fa solo sul portale.
const TIPI_SOLO_PORTALE = ['poste']

export type EsitoAnnulloCondivisa = { esito: 'annullata'; gambe: number } | { esito: 'rifiutata'; motivo: string }

/**
 * ANNULLO, DOPO LE 48 ORE, DI UNA SPEDIZIONE SU CONTRATTO CONDIVISO (corriere-ponte, tipo 'moovexpress').
 *
 * Regola di Lorenzo (5/10/2026): sui condivisi l'annullo si fa sul portale, annullando e stornando — non
 * esiste una chiamata al fornitore come per SpediamoPro. Fino al 13/10 il cron chiedeva l'annullo al ponte,
 * il ponte rispondeva "va gestito dall'assistenza" e la spedizione tornava attiva, ADDEBITATA: 197 su SDA
 * EXPRESS L fra il 4 e il 10 ottobre, 156 delle quali mai partite (1.084,09 € pagati dai clienti).
 *
 * Una spedizione condivisa e' UNA RIGA PER GAMBA (stesso tracking, numero con suffisso): si annullano e si
 * stornano TUTTE, altrimenti i master della catena restano addebitati. Vale solo per i detentori Poste
 * (TIPI_SOLO_PORTALE); se una gamba risulta gia' presa in carico, non si fa niente in automatico.
 * Rischio che resta, lo stesso dei Poste diretti: un pacco consegnato all'ufficio postale DOPO l'annullo non
 * si segue piu' (il giro del tracking salta le annullate) e Poste lo fattura al detentore.
 */
export async function annullaCondivisaDopo48h(
  admin: any,
  s: { id: string; numero: string; tracking_number: string | null; annullamento_da?: string | null },
): Promise<EsitoAnnulloCondivisa> {
  if (!s.tracking_number) return { esito: 'rifiutata', motivo: 'senza lettera di vettura non si ritrovano le gambe della catena' }
  const gambe = await risolviGambeSpedizione(admin, s.tracking_number)
  const ids = Array.from(new Set([s.id, ...gambe.map(g => g.spedizioneId)]))
  const { data: righe, error } = await admin.from('spedizioni')
    .select('id,numero,stato,stato_precedente,dest_nome,corriere_id,raw_response,tracking_number')
    .in('id', ids)
  if (error || !righe?.length) return { esito: 'rifiutata', motivo: 'gambe della catena non lette' }

  const mossa = (righe as any[]).find(r => IN_MANO_AL_CORRIERE.includes(r.stato)
    || (r.stato === 'annullamento_pending' && IN_MANO_AL_CORRIERE.includes(r.stato_precedente)))
  if (mossa) return { esito: 'rifiutata', motivo: 'il pacco risulta già preso in carico dal corriere: l\'annullo va chiesto all\'assistenza' }

  // SOLO SUL PORTALE, E SOLO DOVE LORENZO L'HA DECISO: detentore su contratto Poste (SDA EXPRESS L), che
  // non ha una chiamata di annullo. Per gli altri tipi il detentore ha regole sue (Spedisci va in coda
  // manuale, DVA ha lo storno asincrono, GLS la distinta): li' l'annullo automatico non si fa e la
  // spedizione torna attiva come prima, col motivo scritto. Allargarlo e' una decisione, non un dettaglio.
  const detentore = gambe.find(g => g.tipo && g.tipo !== 'moovexpress')
  if (!detentore || !TIPI_SOLO_PORTALE.includes(detentore.tipo)) {
    return { esito: 'rifiutata', motivo: 'su questo contratto condiviso l\'annullo va gestito dall\'assistenza' }
  }
  const rigaD = (righe as any[]).find(r => r.id === detentore.spedizioneId)
  if (rigaD) {
    // Per Poste non c'e' nessuna chiamata (risponde ok): resta qui perche' se un domani il tipo avra'
    // un annullo vero, passera' da questa riga senza cambiare altro.
    const e = await annullaSpedizioneSulCorriere(admin, rigaD)
    if (!e.ok) return { esito: 'rifiutata', motivo: e.reason || 'il corriere non accetta l\'annullo' }
  }

  let fatte = 0
  for (const r of righe as any[]) {
    if (r.stato !== 'annullata') {
      const { error: eUpd } = await admin.from('spedizioni').update({
        stato: 'annullata',
        stato_precedente: r.stato === 'annullamento_pending' ? (r.stato_precedente || 'in_lavorazione') : r.stato,
        annullamento_errore: null,
      }).eq('id', r.id)
      // Una gamba che non si riesce ad annullare non si storna: meglio un addebito da sistemare a mano
      // che un rimborso su una riga ancora attiva.
      if (eUpd) { console.error('[ANNULLO CONDIVISA] gamba non annullata', r.numero, eUpd.message); continue }
    }
    // Idempotente per movimento: su una gamba gia' annullata crea solo gli storni che mancano.
    await rimborsaAnnulloSpedizione(admin, { id: r.id, numero: r.numero, dest_nome: r.dest_nome }, s.annullamento_da || null)
    fatte++
  }
  return { esito: 'annullata', gambe: fatte }
}
