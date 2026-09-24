import { inviaWebhook } from '@/lib/webhooks'

/* UNA funzione sola per il webhook di tracking al cliente (tracking.updated/delivered/exception).
 *
 * La regola "quando lo stato cambia, avvisa il cliente" DECIDE cosa riceve chi si integra: va messa dove
 * passano TUTTE le porte che aggiornano lo stato, non copiata in alcune. Prima partiva solo dalla cron
 * `aggiorna` (fornitori diretti) e dalla GET del tracking: i backfill poste.it (bonifica-poste,
 * cieche-ingest) — che scrivono lo stato dei contratti Poste via Spedisci, es. Poste Express M — NON la
 * mandavano, e il cliente riceveva solo shipment.created (segnalato da Edit Shop, 23/09). Ora ogni porta
 * che tocca lo stato chiama QUESTA. Best-effort: non blocca né fa fallire il giro.
 *
 * Mappa stato→evento identica alla cron aggiorna: consegnata=delivered; giacenza/non_consegnato/
 * reso_mittente=exception; il resto=updated.
 */
export async function notificaCambioStato(
  admin: any,
  spedizioneId: string,
  nuovoStato: string | null | undefined,
  vecchioStato?: string | null,
): Promise<void> {
  if (!nuovoStato || nuovoStato === vecchioStato) return
  try {
    const { data: s } = await admin.from('spedizioni')
      .select('cliente_id,corriere_id,tracking_number,numero').eq('id', spedizioneId).maybeSingle()
    if (!s?.cliente_id) return
    const { data: c } = await admin.from('corrieri').select('nome_contratto').eq('id', s.corriere_id).maybeSingle()
    const evento = nuovoStato === 'consegnata' ? 'tracking.delivered'
      : (nuovoStato === 'in_giacenza' || nuovoStato === 'non_consegnato' || nuovoStato === 'reso_mittente') ? 'tracking.exception'
      : 'tracking.updated'
    // Fire-and-forget: inviaWebhook fa POST HTTP con retry (fino a ~15s) e NON deve bloccare il giro di
    // aggiornamento (come faceva la vecchia cron aggiorna). Si attendono solo le due letture qui sopra.
    void inviaWebhook({
      clienteId: s.cliente_id, corriereId: s.corriere_id, evento,
      data: {
        tracking_number: s.tracking_number || s.numero,
        carrier: c?.nome_contratto || null,
        status: nuovoStato, location: '', events: [],
      },
    }).catch(() => {})
  } catch { /* best-effort: il webhook non deve mai far cadere l'aggiornamento tracking */ }
}
