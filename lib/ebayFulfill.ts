import { getValidEbayToken, ebayPost } from '@/lib/ebay'

// Rimanda il tracking a eBay alla chiusura distinta (createShippingFulfillment). Best-effort.
export async function fulfillSpedizioniEbay(db: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  const { data: ordini } = await db
    .from('ordini_ecommerce').select('*')
    .in('spedizione_id', spedizioneIds)
    .eq('piattaforma', 'ebay')
  for (const ordine of ordini || []) {
    if (ordine.fulfillment_stato === 'ok') continue
    const segna = async (stato: string, errore: string | null) => {
      await db.from('ordini_ecommerce').update({ fulfillment_stato: stato, fulfillment_errore: errore }).eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      const { data: sped } = await db.from('spedizioni').select('tracking_number, corrieri(nome_contratto)').eq('id', ordine.spedizione_id).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      const company = (sped as any)?.corrieri?.nome_contratto || 'Other'

      const { data: integr } = await db.from('integrazioni').select('*').eq('id', ordine.integrazione_id).maybeSingle()
      if (!integr) { await segna('errore', 'integrazione non trovata'); continue }
      const token = await getValidEbayToken(db, integr)

      const lineItems = (ordine.articoli || []).filter((a: any) => a.lineItemId).map((a: any) => ({ lineItemId: a.lineItemId, quantity: a.quantita || 1 }))
      const bodyReq: any = { shippingCarrierCode: company, trackingNumber: String(tracking) }
      if (lineItems.length) bodyReq.lineItems = lineItems

      await ebayPost(token, `/sell/fulfillment/v1/order/${ordine.ordine_esterno_id}/shipping_fulfillment`, bodyReq)
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
