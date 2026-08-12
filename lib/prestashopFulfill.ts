import { psGet, psGetXml, psPutXml, psPostXml, psXml } from '@/lib/prestashop'

// Rimanda il tracking a PrestaShop alla chiusura distinta: imposta tracking_number
// sull'order_carrier dell'ordine. Best-effort, mai bloccante.
//
// Le SCRITTURE PrestaShop vanno in XML, non in JSON (vedi lib/prestashop.ts): fino al 12/08/2026 si
// inviava JSON e ogni PUT falliva con "String could not be parsed as XML" — nessun tracking tornava
// mai indietro. Ora si legge l'order_carrier in XML, gli si cambia il solo <tracking_number> e lo si
// rimanda tale e quale (round-trip): così non si perdono gli altri campi né si sbaglia lo schema.

// Mette il tracking dentro l'XML dell'order_carrier, gestendo il nodo vuoto <tracking_number/>,
// quello pieno e (per sicurezza) l'assenza del nodo.
function impostaTracking(xml: string, tracking: string): string {
  const nodo = `<tracking_number><![CDATA[${tracking}]]></tracking_number>`
  if (/<tracking_number\s*\/>/.test(xml)) return xml.replace(/<tracking_number\s*\/>/, nodo)
  if (/<tracking_number>[\s\S]*?<\/tracking_number>/.test(xml)) return xml.replace(/<tracking_number>[\s\S]*?<\/tracking_number>/, nodo)
  return xml.replace(/<\/order_carrier>/, `${nodo}</order_carrier>`)
}

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

      // 1) trovo l'id dell'order_carrier dell'ordine (lettura JSON: comoda per estrarre l'id)
      const oc = await psGet(cred.url, cred.key, `order_carriers?filter[id_order]=[${ordine.ordine_esterno_id}]`)
      const carrierId = oc?.order_carriers?.[0]?.id
      if (!carrierId) { await segna('errore', 'order_carrier non trovato'); continue }

      // 2) lo rileggo in XML, ci metto il tracking e lo rimando indietro (round-trip XML)
      const xml = await psGetXml(cred.url, cred.key, `order_carriers/${carrierId}`)
      if (!xml) { await segna('errore', 'order_carrier non leggibile'); continue }
      await psPutXml(cred.url, cred.key, 'order_carriers', carrierId, impostaTracking(xml, String(tracking)))

      // 3) Porto l'ordine allo stato "Spedito" (il solo tracking_number non basta a marcare spedito
      // né ad avvisare il cliente). Cerco lo stato "spedito" del negozio, fallback id 4 (default
      // PrestaShop). Best-effort: se fallisce, il tracking è comunque passato.
      try {
        let shippedId = 4
        try {
          const st = await psGet(cred.url, cred.key, 'order_states?display=full')
          const match = (st?.order_states || []).find((x: any) => /spedit|shipped|exp[ée]di|enviad|versand|verzon/i.test(JSON.stringify(x?.name || '')))
          if (match?.id) shippedId = Number(match.id)
        } catch { /* uso il default */ }
        await psPostXml(cred.url, cred.key, 'order_histories', psXml('order_history', {
          id_order: String(ordine.ordine_esterno_id), id_order_state: String(shippedId),
        }))
      } catch { /* stato non aggiornato: il tracking è già stato inviato */ }

      await segna('ok', null)
    } catch (e: any) {
      let msg = String(e?.message || e).slice(0, 180)
      // 405 su order_carriers = la chiave webservice del negozio non ha il permesso di SCRITTURA:
      // va abilitato dal merchant, non è cosa che possiamo fare noi. Messaggio azionabile.
      if (/Method PUT is not allowed/i.test(msg) || / 405:/.test(msg)) {
        msg = 'La chiave webservice PrestaShop non ha il permesso di scrittura (PUT) su order_carriers: abilitalo in Parametri Avanzati → Webservice → la tua chiave → order_carriers (spunta anche order_histories).'
      }
      await segna('errore', msg)
    }
  }
  return esiti
}
