import { getValidTiktokToken, tiktokRequest } from '@/lib/tiktok'
import { marchioCorriere } from '@/lib/corriere-logo'

// Rimanda il tracking a TikTok Shop alla chiusura distinta (self-managed shipping). Best-effort.
// Flusso 202309: l'ordine ha uno o più package -> per ciascuno si imposta tracking + provider e si spedisce.
export async function fulfillSpedizioniTiktok(db: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  const { data: ordini } = await db
    .from('ordini_ecommerce').select('*')
    .in('spedizione_id', spedizioneIds)
    .eq('piattaforma', 'tiktok')

  // cache provider per integrazione (evita chiamate ripetute)
  const providerCache = new Map<string, any[]>()

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
      // Si abbina sul BRAND pubblico (Poste/BRT/GLS…), non sul nome del NOSTRO contratto: così il match
      // coi provider TikTok è più affidabile e non si ragiona su una stringa che nomina il fornitore.
      const brand = marchioCorriere((sped as any)?.corrieri?.nome_contratto || '').toLowerCase()

      const { data: integr } = await db.from('integrazioni').select('*').eq('id', ordine.integrazione_id).maybeSingle()
      if (!integr) { await segna('errore', 'integrazione non trovata'); continue }
      const cred = (integr.credenziali || {}) as any
      const shopCipher = cred.shop_cipher
      const token = await getValidTiktokToken(db, integr)

      // provider di spedizione (mappo il corriere sul provider TikTok, fallback al primo)
      let providers = providerCache.get(integr.id)
      if (!providers) {
        try {
          const p = await tiktokRequest('GET', '/logistics/202309/shipping_providers', { token, shopCipher })
          providers = p?.data?.shipping_providers || []
        } catch { providers = [] }
        providerCache.set(integr.id, providers)
      }
      // Match sul brand. Se non c'è, NON si usa il primo provider a caso (darebbe al compratore l'URL di
      // tracking di un corriere SBAGLIATO): si cerca un generico ("other/altro"), altrimenti si lascia
      // vuoto e l'ordine si ritenta al giro dopo — meglio ritentare che marcare un vettore errato.
      const match = brand ? (providers || []).find((p: any) => { const n = (p.name || '').toLowerCase(); return n && (n.includes(brand) || brand.includes(n)) }) : null
      const generico = (providers || []).find((p: any) => /\bother\b|general|altro/i.test(p.name || ''))
      const providerId = match?.id || generico?.id

      // package(s) dell'ordine (dal dettaglio ordine)
      let packageIds: string[] = []
      try {
        const det = await tiktokRequest('GET', '/order/202309/orders', { token, shopCipher, query: { ids: String(ordine.ordine_esterno_id) } })
        const o = det?.data?.orders?.[0]
        packageIds = (o?.packages || []).map((p: any) => p.id).filter(Boolean)
      } catch { /* provo comunque a crearne uno */ }
      if (!packageIds.length) {
        try {
          const created = await tiktokRequest('POST', `/fulfillment/202309/orders/${ordine.ordine_esterno_id}/packages`, { token, shopCipher, body: {} })
          const pid = created?.data?.package_id
          if (pid) packageIds = [pid]
        } catch { /* niente */ }
      }
      if (!packageIds.length) { await segna('errore', 'nessun package da spedire'); continue }

      for (const pid of packageIds) {
        const body: any = { tracking_number: String(tracking) }
        if (providerId) body.shipping_provider_id = providerId
        await tiktokRequest('POST', `/fulfillment/202309/packages/${pid}/ship`, { token, shopCipher, body })
      }
      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
