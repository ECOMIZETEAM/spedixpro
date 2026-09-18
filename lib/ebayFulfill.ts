import { getValidEbayToken, ebayPost } from '@/lib/ebay'
import { vettoreFisico } from '@/lib/vettore'

// Brand del vettore (vettoreFisico) → CODICE vettore eBay (ShippingCarrierCodeType). Solo i codici
// VERIFICATI: un codice sbagliato fa RIFIUTARE l'evasione (tracking perso), quindi tutto ciò che non è
// certo resta 'Other' (spedito col numero, senza brand — comportamento di prima). Poste/BRT/GLS/SDA sono
// dall'enum eBay per l'Italia; UPS/DHL sono gli standard globali. Il brand NON è il provider tecnico
// (SpediamoPro/DVA/Spedisci restano nascosti): è il corriere reale, che al compratore si può mostrare.
const EBAY_VETTORE: Record<string, string> = {
  POSTE: 'PosteItaliane',
  BRT: 'Bartolini',
  GLS: 'GLS',
  SDA: 'SDA',
  UPS: 'UPS',
  DHL: 'DHL',
  FEDEX: 'FedEx',
}
function codiceVettoreEbay(corr: { tipo?: string | null; nome_contratto?: string | null } | null): string {
  if (!corr) return 'Other'
  return EBAY_VETTORE[vettoreFisico(corr)] || 'Other'
}

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
      const { data: sped } = await db.from('spedizioni').select('tracking_number, corrieri(nome_contratto,tipo)').eq('id', ordine.spedizione_id).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      // CODICE vettore eBay dal brand reale del contratto (Poste/BRT/GLS/SDA/UPS/DHL): così eBay AGGANCIA
      // la tracciatura per il compratore. Prima era 'Other' fisso → eBay non mostrava il tracking. I codici
      // non certi restano 'Other' (evasione accettata col numero, ma senza brand: mai un codice che eBay
      // rifiuterebbe). Il relation embed torna oggetto (o array secondo la FK): normalizzo.
      const corr: any = Array.isArray((sped as any)?.corrieri) ? (sped as any).corrieri[0] : (sped as any)?.corrieri
      const company = codiceVettoreEbay(corr)

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
