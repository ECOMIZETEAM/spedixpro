// RIPRISTINO di una spedizione in coda d'annullo che risulta PARTITA: la usano il giro dei ripristini
// (api/spedizioni/annulli-recupero-cron) e il tracking (api/tracking/aggiorna), che prima avevano ognuno
// il suo update. Rimette SOLO lo stato, come il pulsante "Ripristina": nessun movimento di credito (lo
// storno avverrebbe solo alla conferma dell'annullo, mai avvenuta) e nessuna chiamata al corriere.
//
// ORDINE GIA' RISPEDITO. Se il cliente ha rifatto lo stesso ordine con un'altra spedizione ancora attiva,
// il database rifiuta il ripristino (indici uniq_sped_ordine_attivo*: un ordine, una spedizione attiva).
// Prima l'errore si ripeteva a ogni giro senza che nessuno decidesse (NL668256518 in coda dal 15/09/2026,
// 1UW1R00039680 dal 23/10, ogni ora nel log), e il tracking lo dava per «ripristinata» ogni 40 minuti
// perche' l'esito dell'update non si leggeva. Ora si lascia in coda con una nota, scritta una volta sola:
// tenere o annullare quella spedizione e' una scelta di chi gestisce la coda, non di un giro automatico.
export const NOTA_ORDINE_GIA_RISPEDITO =
  "Risulta partita, ma lo stesso ordine ha già un'altra spedizione attiva: va decisa a mano (annullare o tenere)."

export type EsitoRipristino = 'ripristinata' | 'ordine_gia_rispedito' | 'non_piu_in_coda' | 'errore'

export async function ripristinaPartita(
  admin: any,
  s: { id: string; numero?: string | null; stato_precedente?: string | null },
  etichetta: string,   // prefisso del log, es. '[ANNULLI][RECUPERO]'
): Promise<EsitoRipristino> {
  // SOLO se e' ancora in coda d'annullo. Il tracking lavora su righe lette fino a qualche minuto prima e
  // parte alla stessa ora del cron degli annulli: senza questo filtro poteva rimettere attiva una
  // spedizione appena annullata e rimborsata — pacco che viaggia e rimborso gia' dato.
  const { error, count } = await admin.from('spedizioni').update({
    stato: s.stato_precedente || 'in_lavorazione',
    stato_precedente: null,
    annullamento_richiesto_at: null,
    annullamento_da: null,
    annullamento_errore: null,
    annullamento_owner_id: null,
  }, { count: 'exact' }).eq('id', s.id).in('stato', ['annullamento_pending', 'annullamento_manuale'])
  if (!error && count === 0) return 'non_piu_in_coda'
  if (!error) { console.warn(`${etichetta} partita → ripristinata:`, s.numero); return 'ripristinata' }

  if (error.code === '23505' && /uniq_sped_ordine_attivo/.test(String(error.message))) {
    const { data: r, error: eLett } = await admin.from('spedizioni').select('annullamento_errore').eq('id', s.id).maybeSingle()
    if (eLett) { console.error(`${etichetta} nota non letta`, s.numero, eLett.message); return 'ordine_gia_rispedito' }
    if (r?.annullamento_errore !== NOTA_ORDINE_GIA_RISPEDITO) {
      const { error: eNota } = await admin.from('spedizioni').update({ annullamento_errore: NOTA_ORDINE_GIA_RISPEDITO }).eq('id', s.id)
      if (eNota) console.error(`${etichetta} nota non scritta`, s.numero, eNota.message)
      else console.warn(`${etichetta} partita, ma l'ordine ha gia' un'altra spedizione attiva: resta in coda per una decisione a mano`, s.numero)
    }
    return 'ordine_gia_rispedito'
  }

  console.error(`${etichetta} ripristino fallito`, s.numero, error.message)
  return 'errore'
}
