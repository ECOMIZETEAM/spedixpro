import { annullaSpedizioneSulCorriere, rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'
import { risolviGambeSpedizione } from '@/lib/condivisione-catena'

// Stati in cui il pacco e' gia' in mano al corriere, o oltre. Per Poste "spedita" e' la presa in carico
// (lib/tracking-poste.ts): da li' in poi un annullo fatto solo sul portale rimborserebbe un pacco che il
// corriere ha preso e fattura.
const IN_MANO_AL_CORRIERE = ['spedita', 'in_transito', 'in_consegna', 'in_giacenza', 'consegnata', 'reso_mittente', 'non_consegnato']

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
 * stornano TUTTE, altrimenti i master della catena restano addebitati. Se la gamba del detentore ha un
 * contratto che sa annullare presso il corriere, l'annullo si chiede prima a lui; se il corriere rifiuta,
 * non si storna niente. Se una gamba risulta gia' presa in carico, non si fa niente in automatico.
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

  // Detentore: la gamba sul contratto vero (non un ponte). Se il suo corriere ha un annullo, prima lui.
  const detentore = gambe.find(g => g.tipo && g.tipo !== 'moovexpress')
  if (detentore) {
    const rigaD = (righe as any[]).find(r => r.id === detentore.spedizioneId)
    if (rigaD) {
      const e = await annullaSpedizioneSulCorriere(admin, rigaD)
      if (!e.ok) return { esito: 'rifiutata', motivo: e.reason || 'il corriere non accetta l\'annullo' }
    }
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
