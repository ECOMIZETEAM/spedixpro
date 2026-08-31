import { fulfillSpedizioniShopify } from '@/lib/shopify'
import { fulfillSpedizioniWoo } from '@/lib/wooFulfill'
import { fulfillSpedizioniPrestashop } from '@/lib/prestashopFulfill'
import { fulfillSpedizioniEbay } from '@/lib/ebayFulfill'
import { fulfillSpedizioniTiktok } from '@/lib/tiktokFulfill'
import { fulfillSpedizioniTemu } from '@/lib/temuFulfill'

// Spinge il tracking a TUTTI i marketplace collegati per le spedizioni date (Shopify, WooCommerce,
// PrestaShop, eBay, TikTok, Temu). Best-effort e IDEMPOTENTE: ogni fulfill salta gli ordini già 'ok',
// quindi si può chiamare più volte (alla creazione distinta E, in futuro, altrove) senza doppioni.
// Usato dalla creazione distinta lato CLIENTE, lato MASTER e dalla chiusura automatica, così eBay &
// co. vengono SEMPRE marcati come spediti col tracking, a prescindere da chi crea la distinta.
export async function fulfillMarketplace(db: any, spedizioneIds: string[]): Promise<any[]> {
  let esiti: any[] = []
  if (!spedizioneIds?.length) return esiti

  // NON si evade allo store con un numero PROVVISORIO. Se la LDV vera non c'è ancora (SpediamoPro/Poste
  // la assegnano async, anche 18h+; DVA parte su TMP-), il numero è il code provvisorio (6A…/TMP-/SP-/
  // DVA-). Spingerlo al compratore = tracking FINTO nella sua email + ordine chiuso 'spedito' sullo store,
  // che poi NON viene mai ri-aggiornato con la LDV vera. Quindi qui si evadono SOLO le spedizioni con LDV
  // definitiva; le altre le riprende `fulfill-retry` appena il tracking diventa vero. Guardia in UN punto
  // solo: vale per Shopify/Woo/PrestaShop/eBay/TikTok/Temu insieme.
  const { ldvProvvisoria } = await import('@/lib/numero-spedizione')
  const { data: sped } = await db.from('spedizioni').select('id,tracking_number').in('id', spedizioneIds)
  const pronti = (sped || [])
    .filter((s: any) => s.tracking_number && !ldvProvvisoria(s.tracking_number))
    .map((s: any) => s.id)
  if (!pronti.length) return esiti

  try { esiti = await fulfillSpedizioniShopify(db, pronti) } catch {}
  try { await fulfillSpedizioniWoo(db, pronti) } catch {}
  try { await fulfillSpedizioniPrestashop(db, pronti) } catch {}
  try { await fulfillSpedizioniEbay(db, pronti) } catch {}
  try { await fulfillSpedizioniTiktok(db, pronti) } catch {}
  try { await fulfillSpedizioniTemu(db, pronti) } catch {}
  return esiti
}
