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
  //
  // NON si evade nemmeno una spedizione ANNULLATA. Sembra impossibile che ci arrivi, e invece ci
  // arrivava: chi annulla sgancia l'ordine dalla spedizione, ma questa funzione la chiamano in sei
  // punti e basta che uno passi l'id di una spedizione appena annullata perche' il compratore riceva
  // l'email di spedizione con un tracking gia' morto. La guardia sta QUI, dove passano tutte e sei le
  // piattaforme, invece che in ognuna delle porte che annullano.
  const ANNULLATE = ['annullata', 'annullamento_pending', 'annullamento_manuale']
  const { ldvProvvisoria } = await import('@/lib/numero-spedizione')
  const { data: sped } = await db.from('spedizioni').select('id,tracking_number,stato').in('id', spedizioneIds)
  const pronti = (sped || [])
    .filter((s: any) => s.tracking_number && !ldvProvvisoria(s.tracking_number))
    .filter((s: any) => !ANNULLATE.includes(String(s.stato || '')))
    .map((s: any) => s.id)
  if (!pronti.length) return esiti

  // DA QUI IN POI SI USA IL CLIENT ADMIN.
  //
  // Il perimetro l'ha gia' deciso la lettura qui sopra: `pronti` contiene solo spedizioni che il
  // chiamante poteva vedere. Quello che serve adesso e' un'altra cosa: leggere le CREDENZIALI del
  // negozio (il token che il negoziante ci ha dato). Quel campo non deve essere leggibile dalla
  // sessione di un utente — nemmeno dal master a monte — quindi lo legge il service_role, come fa
  // gia' il cron di recupero. Nota per chi tocchera' questo file: e' anche la condizione perche' il
  // grant SELECT su `integrazioni.credenziali` possa restare tolto ad `authenticated`.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adm = createAdminSupabase()

  try { esiti = await fulfillSpedizioniShopify(adm, pronti) } catch {}
  try { await fulfillSpedizioniWoo(adm, pronti) } catch {}
  try { await fulfillSpedizioniPrestashop(adm, pronti) } catch {}
  try { await fulfillSpedizioniEbay(adm, pronti) } catch {}
  try { await fulfillSpedizioniTiktok(adm, pronti) } catch {}
  try { await fulfillSpedizioniTemu(adm, pronti) } catch {}
  return esiti
}
