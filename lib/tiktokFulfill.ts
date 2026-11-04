import { getValidTiktokToken, tiktokRequest } from '@/lib/tiktok'
import { marchioCorriere } from '@/lib/corriere-logo'
import { righeDaEvadere } from '@/lib/evasione-ordini'

// Rimanda il tracking a TikTok Shop alla chiusura distinta (spedizione del venditore). Best-effort.
//
// COME LO DICE LA GUIDA, NON COME SEMBRAVA. Fino al 4/11/2026 nessuna delle tre chiamate era giusta, e il
// tracking non sarebbe mai arrivato a TikTok (i negozi collegati erano zero, quindi non e' mai successo):
// - i corrieri si chiedevano a /logistics/202309/shipping_providers, che non esiste: dipendono dall'opzione
//   di consegna dell'ordine (Get Shipping Providers, /delivery_options/{id}/shipping_providers);
// - POST /fulfillment/…/orders/{id}/packages col corpo vuoto, per «creare un pacco»: e' invece Mark Package
//   As Shipped, che vuole tracking e corriere, e senza fallisce;
// - Ship Package riceveva tracking e corriere fuori da `self_shipment`, e il corriere poteva mancare: per la
//   spedizione del venditore sono obbligatori tutti e due, dentro `self_shipment`.
// Ora: Mark Package As Shipped (la via della guida per chi spedisce col suo corriere, attiva in Italia), e
// Ship Package sui pacchi gia' creati da TikTok se la prima rifiuta.
export async function fulfillSpedizioniTiktok(db: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  // Quali righe evadere lo decide lib/evasione-ordini, uguale per i sei negozi.
  const righe = await righeDaEvadere(db, spedizioneIds, 'tiktok')

  // cache provider per integrazione (evita chiamate ripetute)
  const providerCache = new Map<string, any[]>()

  for (const { ordine, spedizioneId } of righe) {
    if (ordine.fulfillment_stato === 'ok') continue
    const segna = async (stato: string, errore: string | null) => {
      await db.from('ordini_ecommerce').update({ fulfillment_stato: stato, fulfillment_errore: errore }).eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      const { data: sped } = await db.from('spedizioni').select('tracking_number, corrieri(nome_contratto)').eq('id', spedizioneId).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      // Si abbina sul BRAND pubblico (Poste/BRT/GLS…), non sul nome del NOSTRO contratto: così il match
      // coi provider TikTok è più affidabile e non si ragiona su una stringa che nomina il fornitore.
      const brand = marchioCorriere((sped as any)?.corrieri?.nome_contratto || '').toLowerCase()

      const { data: integr } = await db.from('integrazioni').select('*').eq('id', ordine.integrazione_id).maybeSingle()
      if (!integr) { await segna('errore', 'integrazione non trovata'); continue }
      const cred = (integr.credenziali || {}) as any
      const shopCipher = cred.shop_cipher
      const token = await getValidTiktokToken(db, integr)

      const esito = await evadiOrdineTiktok({ token, shopCipher, ordineId: String(ordine.ordine_esterno_id), tracking: String(tracking), brand, providerCache, chiaveCache: integr.id })
      if (!esito.ok) { await segna('errore', esito.errore); continue }
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}

export type EsitoEvasioneTiktok = { ok: true; via: 'gia_segnato' | 'mark_as_shipped' | 'ship_package' } | { ok: false; errore: string }

// UN ORDINE, UN TRACKING: quello che si fa su TikTok, senza leggere ne' scrivere il nostro database. Sta a
// parte per poterlo provare su un negozio di sviluppo con un tracking finto, senza una spedizione vera (e
// un'etichetta pagata) dietro. Un rifiuto di TikTok risale come eccezione; i casi che non si possono evadere
// tornano come errore leggibile, e il recupero (fulfill-retry) li ritenta.
export async function evadiOrdineTiktok(o: {
  token: string; shopCipher: string; ordineId: string; tracking: string; brand: string
  providerCache?: Map<string, any[]>; chiaveCache?: string
}): Promise<EsitoEvasioneTiktok> {
  const { token, shopCipher, ordineId, tracking, brand } = o
  // L'ordine come lo vede TikTok adesso: chi lo spedisce, l'opzione di consegna (da cui dipendono i
  // corrieri ammessi), le righe e i pacchi. Una lettura fallita va nell'errore e si ritenta al giro dopo.
  const det = await tiktokRequest('GET', '/order/202309/orders', { token, shopCipher, query: { ids: ordineId } })
  const ord = det?.data?.orders?.[0]
  if (!ord) return { ok: false, errore: 'ordine non trovato su TikTok' }
  // La sync importa solo gli ordini del venditore (lib/tiktokSync), ma il tipo puo' cambiare sul negozio.
  if (ord.shipping_type && ord.shipping_type !== 'SELLER') return { ok: false, errore: `spedizione ${ord.shipping_type} gestita da TikTok: tracking non caricabile` }
  // Gia' segnato con questo tracking (un giro precedente arrivato a TikTok ma non registrato qui).
  if (ord.tracking_number && String(ord.tracking_number) === tracking) return { ok: true, via: 'gia_segnato' }

  const opzione = String(ord.delivery_option_id || '')
  if (!opzione) return { ok: false, errore: 'opzione di consegna dell\'ordine mancante' }
  const chiave = `${o.chiaveCache || ''}|${opzione}`
  let providers = o.providerCache?.get(chiave)
  if (!providers) {
    const p = await tiktokRequest('GET', `/logistics/202309/delivery_options/${encodeURIComponent(opzione)}/shipping_providers`, { token, shopCipher })
    providers = (p?.data?.shipping_providers || []) as any[]
    o.providerCache?.set(chiave, providers)
  }
  // Match sul brand. Se non c'è, NON si usa il primo provider a caso (darebbe al compratore l'URL di
  // tracking di un corriere SBAGLIATO): si cerca un generico ("other/altro"), altrimenti l'ordine resta
  // in errore e si ritenta al giro dopo — meglio ritentare che marcare un vettore errato.
  const match = brand ? providers.find((p: any) => { const n = (p.name || '').toLowerCase(); return n && (n.includes(brand) || brand.includes(n)) }) : null
  const generico = providers.find((p: any) => /\bother\b|general|altro/i.test(p.name || ''))
  const providerId = match?.id || generico?.id
  if (!providerId) return { ok: false, errore: `corriere ${brand || 'sconosciuto'} non fra quelli ammessi da TikTok per l'ordine` }
  const spedizione = { tracking_number: tracking, shipping_provider_id: String(providerId) }

  const righeOrdine = (ord.line_items || []).map((li: any) => li?.id).filter(Boolean)
  try {
    await tiktokRequest('POST', `/fulfillment/202610/orders/${encodeURIComponent(ordineId)}/packages`, {
      token, shopCipher,
      body: { ...(righeOrdine.length ? { order_line_list: righeOrdine.map((id: any) => ({ order_line_id: String(id) })) } : {}), shipping_info_list: [spedizione] },
    })
    return { ok: true, via: 'mark_as_shipped' }
  } catch (e1: any) {
    const pacchi = (ord.packages || []).map((p: any) => p?.id).filter(Boolean)
    if (!pacchi.length) throw e1
    try {
      for (const pid of pacchi) {
        await tiktokRequest('POST', `/fulfillment/202309/packages/${encodeURIComponent(String(pid))}/ship`, { token, shopCipher, body: { self_shipment: spedizione } })
      }
      return { ok: true, via: 'ship_package' }
    } catch (e2: any) {
      throw new Error(`${e1?.message || e1} | ship: ${e2?.message || e2}`)
    }
  }
}
