import { tokenAmazon, spapi, MARKETPLACE_IT, LimiteAmazon } from '@/lib/amazon'
import { vettoreAmazon } from '@/lib/amazon-vettore'

// CONFERMA DI SPEDIZIONE AD AMAZON col tracking, alla chiusura distinta (lib/fulfillMarketplace).
//
// confirmShipment della Orders API v0: la v2026-01-01 non ha un'operazione per confermare, e
// questa non e' fra quelle dismesse (verificato il 19/10/2026). Un pacco per ordine: lo stesso
// `packageReferenceId` ('1') a ogni invio, cosi' un nuovo tentativo CORREGGE la conferma invece
// di aggiungere un secondo pacco. Amazon risponde 204 senza corpo.
//
// Gli ordini UNITI in un solo pacco (lib/ordini-uniti) si confermano col tracking del pacco del
// capofila, subito dopo di lui: se restano non confermati, per Amazon il venditore non li ha
// spediti (ritardi e reclami sul suo account), come gia' si fa nel file di conferma per gli ordini
// da file. Il cron fulfill-retry li rimette in giro se restano indietro.
//
// Si salta (stato terminale 'annullato_store') un ordine che Amazon da' annullato: nel pacco non
// c'e' (lib/ordini-uniti lo lascia fuori) e confermarlo darebbe solo un errore.
//
// Amazon concede 2 conferme al secondo (raffica di 10), e questa funzione gira dentro la
// creazione della distinta, che l'utente aspetta: oltre TEMPO_MAX_MS non si comincia un'altra
// conferma, e a "troppe chiamate" ci si ferma invece di aspettare. Il cron fulfill-retry riprende
// gli ordini rimasti senza esito; `tentati` gli dice quali sono stati davvero mandati, perche'
// solo quelli consumano un tentativo.
const TEMPO_MAX_MS = 30000

// Letture a blocchi di 200 id: gli id finiscono nell'indirizzo della richiesta, e oltre ~450 la
// richiesta torna "Bad Request" (il guasto che ha fermato purge-pii da settembre 2026).
async function leggiABlocchi(ids: string[], leggi: (blocco: string[]) => PromiseLike<{ data: any[] | null }>): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await leggi(ids.slice(i, i + 200))
    out.push(...(data || []))
  }
  return out
}

export async function fulfillSpedizioniAmazon(db: any, spedizioneIds: string[], tentati?: Set<string>) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  const colonne = 'id,integrazione_id,ordine_esterno_id,numero_ordine,articoli,spedizione_id,unito_in,stato_pagamento,fulfillment_stato,created_at'
  const righeDirette = await leggiABlocchi(spedizioneIds, b => db.from('ordini_ecommerce').select(colonne)
    .in('spedizione_id', b).eq('piattaforma', 'amazon'))
  if (!righeDirette.length) return esiti
  // I piu' vecchi per primi: se il tempo non basta restano fuori i piu' recenti, non sempre gli stessi.
  const diretti = [...righeDirette].sort((a: any, b: any) => String(a.created_at || '').localeCompare(String(b.created_at || '')))

  // Gli uniti dei capofila qui sopra: viaggiano nel pacco del capofila e si confermano subito dopo
  // di lui, cosi' il limite di tempo non taglia sempre loro. Non quelli che hanno una spedizione
  // loro (spediti a parte): si confermano col proprio tracking, come ordini diretti.
  const uniti = await leggiABlocchi(diretti.map((o: any) => String(o.id)), b => db.from('ordini_ecommerce').select(colonne)
    .in('unito_in', b).eq('piattaforma', 'amazon').is('spedizione_id', null))
  const unitiDi = new Map<string, any[]>()
  for (const u of uniti) {
    const k = String(u.unito_in)
    if (!unitiDi.has(k)) unitiDi.set(k, [])
    unitiDi.get(k)!.push(u)
  }
  const daConfermare: { o: any; spedId: string }[] = []
  for (const capo of diretti) {
    daConfermare.push({ o: capo, spedId: String(capo.spedizione_id) })
    for (const u of unitiDi.get(String(capo.id)) || []) daConfermare.push({ o: u, spedId: String(capo.spedizione_id) })
  }
  const restanti = daConfermare.filter(x => x.o.fulfillment_stato !== 'ok' && x.o.fulfillment_stato !== 'annullato_store')
  if (!restanti.length) return esiti

  const sped = await leggiABlocchi(Array.from(new Set(restanti.map(x => x.spedId))), b => db.from('spedizioni')
    .select('id, tracking_number, created_at, corrieri(nome_contratto, tipo, settings)').in('id', b))
  const spedizioni = new Map<string, any>(sped.map((s: any) => [String(s.id), s]))

  const token = new Map<string, string>()
  const integrazioni = new Map<string, any>()
  const avvio = Date.now()

  for (const { o: ordine, spedId } of restanti) {
    if (Date.now() - avvio > TEMPO_MAX_MS) break
    tentati?.add(String(ordine.id))
    const segna = async (stato: string, errore: string | null) => {
      await db.from('ordini_ecommerce').update({ fulfillment_stato: stato, fulfillment_errore: errore }).eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      if (String(ordine.stato_pagamento || '').toUpperCase() === 'CANCELLED') { await segna('annullato_store', 'annullato su Amazon'); continue }
      const s = spedizioni.get(spedId)
      const tracking = s?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      const righe = (Array.isArray(ordine.articoli) ? ordine.articoli : [])
        .filter((a: any) => a?.order_item_id && Number(a?.quantita) > 0)
        .map((a: any) => ({ orderItemId: String(a.order_item_id), quantity: Number(a.quantita) }))
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
      await spapi(token.get(iid)!, 'POST', `/orders/v0/orders/${encodeURIComponent(String(ordine.ordine_esterno_id))}/shipmentConfirmation`, { corpo, tentativi: 1 })
      await segna('ok', null)
    } catch (e: any) {
      // Limite di Amazon: non e' un errore dell'ordine. Ci si ferma qui, e quest'ordine non conta
      // come tentato: lo riprende il recupero senza consumargli un tentativo.
      if (e instanceof LimiteAmazon) { tentati?.delete(String(ordine.id)); break }
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
