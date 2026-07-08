import { psGet, psPut } from '@/lib/prestashop'

// Rimanda il tracking a PrestaShop alla chiusura distinta: imposta tracking_number
// sull'order_carrier dell'ordine. Best-effort, mai bloccante.
export async function fulfillSpedizioniPrestashop(db: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  const { data: ordini } = await db
    .from('ordini_ecommerce').select('*')
    .in('spedizione_id', spedizioneIds)
    .eq('piattaforma', 'prestashop')
  for (const ordine of ordini || []) {
    if (ordine.fulfillment_stato === 'ok') continue
    const segna = async (stato: string, errore: string | null) => {
      await db.from('ordini_ecommerce').update({ fulfillment_stato: stato, fulfillment_errore: errore }).eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      const { data: sped } = await db.from('spedizioni').select('tracking_number').eq('id', ordine.spedizione_id).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }

      const { data: integr } = await db.from('integrazioni').select('credenziali').eq('id', ordine.integrazione_id).maybeSingle()
      const cred = integr?.credenziali as any
      if (!cred?.url || !cred?.key) { await segna('errore', 'integrazione non trovata'); continue }

      const oc = await psGet(cred.url, cred.key, `order_carriers?filter[id_order]=[${ordine.ordine_esterno_id}]&display=full`)
      const carrier = oc?.order_carriers?.[0]
      if (!carrier?.id) { await segna('errore', 'order_carrier non trovato'); continue }

      carrier.tracking_number = String(tracking)
      await psPut(cred.url, cred.key, 'order_carriers', carrier.id, { order_carrier: carrier })
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
