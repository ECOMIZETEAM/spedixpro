// I NUMERI CON CUI SI CERCA UN ORDINE DEL NEGOZIO.
//
// PrestaShop ne mostra due nel back office: il riferimento a lettere (CLQUIQMXS, che da noi e'
// numero_ordine) e l'ID numerico (115231, che da noi e' ordine_esterno_id). Molti negozianti lavorano
// con l'ID, e la ricerca guardava solo il riferimento: un ordine cercato per ID non si trovava.
// Solo PrestaShop: altrove l'id esterno non e' quello che il negoziante vede (su Shopify e' un numero
// lungo interno, e una ricerca per "10" troverebbe ordini a caso).
export function numeriOrdine(o: any, piattaforma: string): string[] {
  const numeri = [String(o?.numero_ordine || '')]
  if (piattaforma === 'prestashop' && o?.ordine_esterno_id) numeri.push(String(o.ordine_esterno_id))
  return numeri.filter(Boolean)
}

// Su PrestaShop il cancelletto non conta: "#115231" e "115231" sono lo stesso ordine (un ordine senza
// riferimento lo scriviamo "#id"). Sulle altre piattaforme la ricerca resta quella di prima, carattere
// per carattere: togliere il cancelletto anche li' allargava i risultati ("#11-1" su eBay trovava
// anche "#13-15111-…").
const pulito = (s: string) => s.trim().toLowerCase().replace(/^#/, '')

export function numeroOrdineCorrisponde(o: any, piattaforma: string, cerca: string): boolean {
  if (piattaforma !== 'prestashop') return String(o?.numero_ordine || '').toLowerCase().includes(String(cerca || '').toLowerCase())
  const q = pulito(String(cerca || ''))
  if (!q) return true
  return numeriOrdine(o, piattaforma).some(n => pulito(n).includes(q))
}
