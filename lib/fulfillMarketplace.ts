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
  try { esiti = await fulfillSpedizioniShopify(db, spedizioneIds) } catch {}
  try { await fulfillSpedizioniWoo(db, spedizioneIds) } catch {}
  try { await fulfillSpedizioniPrestashop(db, spedizioneIds) } catch {}
  try { await fulfillSpedizioniEbay(db, spedizioneIds) } catch {}
  try { await fulfillSpedizioniTiktok(db, spedizioneIds) } catch {}
  try { await fulfillSpedizioniTemu(db, spedizioneIds) } catch {}
  return esiti
}
