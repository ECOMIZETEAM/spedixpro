import { tokenAmazon, spapi, MARKETPLACE_IT } from '@/lib/amazon'
import { vettoreAmazon } from '@/lib/amazon-vettore'

// CONFERMA DI SPEDIZIONE AD AMAZON col tracking, alla chiusura distinta (lib/fulfillMarketplace).
//
// confirmShipment della Orders API v0: la v2026-01-01 non ha un'operazione per confermare, e
// questa non e' fra quelle dismesse (verificato il 19/10/2026). Un pacco per ordine: lo stesso
// `packageReferenceId` ('1') a ogni invio, cosi' un nuovo tentativo CORREGGE la conferma invece
// di aggiungere un secondo pacco. Amazon risponde 204 senza corpo.
//
// Gli ordini UNITI in un solo pacco (lib/ordini-uniti) si confermano col tracking del pacco del
// capofila: se restano non confermati, per Amazon il venditore non li ha spediti (ritardi e
// reclami sul suo account), come gia' si fa nel file di conferma per gli ordini da file.
//
// Amazon concede 2 conferme al secondo (raffica di 10): oltre TEMPO_MAX_MS ci si ferma, e il cron
// fulfill-retry riprende gli ordini rimasti senza esito.
const TEMPO_MAX_MS = 60000

export async function fulfillSpedizioniAmazon(db: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  const colonne = 'id,integrazione_id,ordine_esterno_id,numero_ordine,articoli,spedizione_id,unito_in,fulfillment_stato'
  const { data: diretti } = await db.from('ordini_ecommerce').select(colonne)
    .in('spedizione_id', spedizioneIds).eq('piattaforma', 'amazon')
  if (!diretti?.length) return esiti

  // Gli assorbiti dei capofila qui sopra: viaggiano nel pacco del capofila.
  const { data: assorbiti } = await db.from('ordini_ecommerce').select(colonne)
    .in('unito_in', diretti.map((o: any) => o.id)).eq('piattaforma', 'amazon')
  const spedDi = new Map<string, string>(diretti.map((o: any) => [String(o.id), String(o.spedizione_id)]))
  const daConfermare = [
    ...diretti.map((o: any) => ({ o, spedId: String(o.spedizione_id) })),
    ...(assorbiti || []).map((o: any) => ({ o, spedId: spedDi.get(String(o.unito_in)) || '' })),
  ].filter(x => x.spedId && x.o.fulfillment_stato !== 'ok')
  if (!daConfermare.length) return esiti

  const { data: sped } = await db.from('spedizioni')
    .select('id, tracking_number, created_at, corrieri(nome_contratto, tipo, settings)')
    .in('id', Array.from(new Set(daConfermare.map(x => x.spedId))))
  const spedizioni = new Map<string, any>((sped || []).map((s: any) => [String(s.id), s]))

  const token = new Map<string, string>()
  const integrazioni = new Map<string, any>()
  const avvio = Date.now()

  for (const { o: ordine, spedId } of daConfermare) {
    if (Date.now() - avvio > TEMPO_MAX_MS) break
    const segna = async (stato: string, errore: string | null) => {
      await db.from('ordini_ecommerce').update({ fulfillment_stato: stato, fulfillment_errore: errore }).eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      const s = spedizioni.get(spedId)
      const tracking = s?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      const righe = (Array.isArray(ordine.articoli) ? ordine.articoli : [])
        .filter((a: any) => a?.order_item_id)
        .map((a: any) => ({ orderItemId: String(a.order_item_id), quantity: Number(a.quantita) || 1 }))
      if (!righe.length) { await segna('errore', 'articoli dell\'ordine Amazon mancanti'); continue }

      const iid = String(ordine.integrazione_id)
      if (!integrazioni.has(iid)) {
        const { data: integr } = await db.from('integrazioni').select('*').eq('id', iid).maybeSingle()
        integrazioni.set(iid, integr || null)
      }
      const integr = integrazioni.get(iid)
      if (!integr) { await segna('errore', 'integrazione non trovata'); continue }
      if (!token.has(iid)) token.set(iid, await tokenAmazon(db, integr))

      // Il corriere reale del contratto, mai il fornitore tecnico (lib/amazon-vettore).
      const corr: any = Array.isArray(s?.corrieri) ? s.corrieri[0] : s?.corrieri
      const v = vettoreAmazon(corr)
      // Data di spedizione: quando l'etichetta e' nata, mai nel futuro (Amazon la rifiuta).
      const quando = Math.min(Date.parse(s?.created_at || '') || Date.now(), Date.now())
      const corpo = {
        marketplaceId: MARKETPLACE_IT,
        packageDetail: {
          packageReferenceId: '1',
          carrierCode: v.carrierCode,
          ...(v.carrierName ? { carrierName: v.carrierName } : {}),
          shippingMethod: v.shippingMethod,
          trackingNumber: String(tracking),
          shipDate: new Date(quando).toISOString(),
          orderItems: righe,
        },
      }
      await spapi(token.get(iid)!, 'POST', `/orders/v0/orders/${encodeURIComponent(String(ordine.ordine_esterno_id))}/shipmentConfirmation`, { corpo })
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
