import { fulfillSpedizioniShopify } from '@/lib/shopify'
import { fulfillSpedizioniWoo } from '@/lib/wooFulfill'
import { fulfillSpedizioniPrestashop } from '@/lib/prestashopFulfill'
import { fulfillSpedizioniEbay } from '@/lib/ebayFulfill'
import { fulfillSpedizioniTiktok } from '@/lib/tiktokFulfill'
import { fulfillSpedizioniTemu } from '@/lib/temuFulfill'
import { fulfillSpedizioniAmazon } from '@/lib/amazonFulfill'
import { STATI_SPEDIZIONE_IN_ANNULLO } from '@/lib/evasione-ordini'

// Spinge il tracking a TUTTI i marketplace collegati per le spedizioni date (Shopify, WooCommerce, Amazon,
// PrestaShop, eBay, TikTok, Temu). Best-effort e IDEMPOTENTE: ogni fulfill salta gli ordini già 'ok',
// quindi si può chiamare più volte (alla creazione distinta E, in futuro, altrove) senza doppioni.
// Usato dalla creazione distinta lato CLIENTE, lato MASTER e dalla chiusura automatica, così eBay &
// co. vengono SEMPRE marcati come spediti col tracking, a prescindere da chi crea la distinta.
// `opz.tentatiAmazon`: chi lo passa (il cron fulfill-retry) ci trova gli ordini Amazon davvero
// mandati ad Amazon — l'unica evasione con un limite di tempo, quindi l'unica che puo' lasciarne
// indietro senza averli tentati. `opz.scadenzaAmazon`: quel limite, unico per chi chiama piu'
// volte nello stesso giro. Gli altri chiamanti non li passano e non cambia niente.
export async function fulfillMarketplace(db: any, spedizioneIds: string[], opz: { tentatiAmazon?: Set<string>; scadenzaAmazon?: number } = {}): Promise<any[]> {
  let esiti: any[] = []
  if (!spedizioneIds?.length) return esiti

  // NON si evade allo store con un numero PROVVISORIO. Se la LDV vera non c'è ancora (SpediamoPro/Poste
  // la assegnano async, anche 18h+; DVA parte su TMP-), il numero è il code provvisorio (6A…/TMP-/SP-/
  // DVA-). Spingerlo al compratore = tracking FINTO nella sua email + ordine chiuso 'spedito' sullo store,
  // che poi NON viene mai ri-aggiornato con la LDV vera. Quindi qui si evadono SOLO le spedizioni con LDV
  // definitiva; le altre le riprende `fulfill-retry` appena il tracking diventa vero. Guardia in UN punto
  // solo: vale per Shopify/Woo/PrestaShop/eBay/TikTok/Temu/Amazon insieme.
  //
  // NON si evade nemmeno una spedizione ANNULLATA, o che si sta annullando. Lo sgancio dell'ordine lo fa
  // il database (trigger trg_ordine_torna_da_spedire, quando la spedizione diventa 'annullata'), ma le
  // spinte arrivano anche dopo: girano in after() a risposta gia' data, e il recupero ripassa ogni 20
  // minuti. Basta che una passi l'id di una spedizione appena annullata, o in attesa d'annullo, perche' il
  // compratore riceva l'email di spedizione con un tracking gia' morto. La guardia sta QUI, dove passano
  // tutte e sette le piattaforme, con la lista degli stati scritta in un posto solo (lib/evasione-ordini).
  const { ldvProvvisoria } = await import('@/lib/numero-spedizione')
  const { data: sped } = await db.from('spedizioni').select('id,tracking_number,stato').in('id', spedizioneIds)
  const pronti = (sped || [])
    .filter((s: any) => s.tracking_number && !ldvProvvisoria(s.tracking_number))
    .filter((s: any) => !STATI_SPEDIZIONE_IN_ANNULLO.includes(String(s.stato || '')))
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

  // Una piattaforma che fallisce non ferma le altre, ma lo dice: prima il catch era muto, e un errore
  // nella lettura delle righe da evadere (lib/evasione-ordini) spariva senza lasciare traccia.
  const passa = async (piattaforma: string, evadi: () => Promise<any>) => {
    try { return await evadi() } catch (e: any) {
      console.error('[FULFILL]', piattaforma, 'evasione non eseguita:', String(e?.message || e).slice(0, 200))
      return null
    }
  }
  esiti = (await passa('shopify', () => fulfillSpedizioniShopify(adm, pronti))) || []
  await passa('woocommerce', () => fulfillSpedizioniWoo(adm, pronti))
  await passa('prestashop', () => fulfillSpedizioniPrestashop(adm, pronti))
  await passa('ebay', () => fulfillSpedizioniEbay(adm, pronti))
  await passa('tiktok', () => fulfillSpedizioniTiktok(adm, pronti))
  await passa('temu', () => fulfillSpedizioniTemu(adm, pronti))
  await passa('amazon', () => fulfillSpedizioniAmazon(adm, pronti, opz.tentatiAmazon, opz.scadenzaAmazon))
  return esiti
}
