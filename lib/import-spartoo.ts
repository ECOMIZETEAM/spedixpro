// PRE-NORMALIZZATORE DELL'EXPORT SPARTOO (portale moda/scarpe) PER L'IMPORT ORDINI.
//
// Perche' a parte e non altri alias: Spartoo NON entra nel semplice schema "un header = un campo" degli
// altri (Shopify/Amazon/Temu). Ha tre scomodita' insieme:
//  1) il nome destinatario e' SPEZZATO in delivery_firstname + delivery_lastname (un alias singolo non
//     puo' concatenare);
//  2) 'shipping_name' qui e' il CORRIERE ("BRT 1", "UPS Standard"), NON il destinatario — e per Shopify
//     'shipping_name' e' invece il destinatario: metterlo negli alias romperebbe l'uno o l'altro;
//  3) l'ordine e' MULTI-RIGA con le colonne ordine vuote sulle righe di continuazione, e va usato
//     l'indirizzo di CONSEGNA (delivery_*), non l'anagrafica (customers_*).
//
// Soluzione: riconosco il file e lo RIMAPPO sulle colonne CANONICHE del nostro import (destinatario,
// indirizzo, cap, ...) PRIMA dell'auto-mapping. Cosi' riusa la stessa pipeline (raggruppamento
// multi-riga, provincia-da-CAP, estero, dedup) e NON tocco gli alias degli altri marketplace. Le
// colonne canoniche vincono nell'auto-mapping perche' sono la 1ª voce di ogni lista di alias
// (es. 'destinatario' batte 'shipping_name').
//
// NB: gli header arrivano gia' normalizzati (minuscolo, spazi->_, ';' come separatore autodetect di
// papaparse), quindi qui li leggo come 'delivery_firstname', 'orders_id', ecc.

// Riconosce l'export Spartoo dalle sue colonne caratteristiche. 'products_spartoo' e' la firma certa;
// in alternativa 'orders_id' + 'customers_country_iso' + una via (di consegna o anagrafica) — combinazione
// che nessun altro export (Shopify/Amazon/Temu/nostro template) produce, quindi niente falsi positivi.
export function eSpartoo(r0: Record<string, string> | undefined): boolean {
  if (!r0) return false
  const k = new Set(Object.keys(r0))
  if (k.has('products_spartoo')) return true
  return k.has('orders_id') && k.has('customers_country_iso')
    && (k.has('delivery_street_address') || k.has('customers_street_address'))
}

// L'export Spartoo arriva spesso a DOPPIA codifica (UTF-8 riletto come Latin-1): "Höfen"->"HÃ¶fen",
// "Straße"->"StraÃe". Se non si corregge, la citta'/via estera parte sbagliata e la consegna puo'
// fallire. Correzione mirata e SICURA: agisco solo se c'e' la firma del mojibake ("Ã"/"Â") E tutti i
// caratteri stanno nel byte Latin-1 (< 256) — condizione vera solo per il mojibake, non per un testo
// gia' corretto (che quindi resta intatto). Ri-decodifico i byte Latin-1 come UTF-8.
function correggiMojibake(s: string): string {
  if (!s || !/[ÃÂ]/.test(s)) return s
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return s   // non e' il classico mojibake: non tocco
  try {
    const bytes = Uint8Array.from([...s].map(c => c.charCodeAt(0) & 0xff))
    const dec = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return dec.includes('�') ? s : dec   // se la ri-decodifica produce caratteri invalidi, lascio l'originale
  } catch { return s }
}

// Rimappa le righe Spartoo sulle colonne canoniche. Tiene le colonne originali e AGGIUNGE le canoniche
// (che vincono nell'auto-mapping). Salta gli ordini ANNULLATI (header e relative righe di continuazione).
export function rimappaSpartoo(rows: Record<string, string>[]): Record<string, string>[] {
  const v = (r: any, key: string) => correggiMojibake(String(r?.[key] ?? '').trim())
  const out: Record<string, string>[] = []
  let ordineAnnullato = false
  for (const r of rows) {
    if (v(r, 'orders_id')) {
      // Nuovo ordine: (ri)valuto se e' ANNULLATO. Vale anche per le sue righe prodotto successive, che
      // hanno le colonne ordine (incluso lo stato) vuote.
      ordineAnnullato = v(r, 'orders_status_id') === '41' || /cancellat|annullat/i.test(v(r, 'orders_status_name'))
    }
    if (ordineAnnullato) continue

    // Indirizzo di CONSEGNA con ripiego sull'anagrafica CLIENTE quando i campi delivery_* mancano
    // (alcuni export Spartoo spediscono all'indirizzo di fatturazione: solo customers_* valorizzati).
    const dc = (base: string) => v(r, 'delivery_' + base) || v(r, 'customers_' + base)
    // Destinatario: nome+cognome di CONSEGNA; se manca, nome del CLIENTE (buyer); solo in ultima istanza
    // la ragione sociale. Cosi' NON finisce mai il civico come "nome" (Spartoo mette spesso il civico
    // nella colonna "company", vedi sotto).
    const nomeConsegna = [v(r, 'delivery_firstname'), v(r, 'delivery_lastname')].filter(Boolean).join(' ')
    const nomeCliente = [v(r, 'customers_firstname'), v(r, 'customers_lastname')].filter(Boolean).join(' ')
    const azienda = dc('company')
    const destinatario = nomeConsegna || nomeCliente || azienda
    // Spartoo mette SPESSO il CIVICO nella colonna "company" (es. "15") e un c/o o l'azienda in "suburb":
    // porto SEMPRE entrambi in 2ª riga d'indirizzo. La pipeline unisce indirizzo+indirizzo2 in un'unica
    // stringa, quindi il civico non si perde MAI (nemmeno quando il nome di consegna manca e la company
    // e' finita nel destinatario). L'azienda reale (es. "GES SPA") resta comunque sull'etichetta.
    const secondaRiga = [azienda, dc('suburb')].filter(Boolean).join(' ')

    out.push({
      ...r,
      destinatario,
      indirizzo: dc('street_address'),
      indirizzo2: secondaRiga,
      cap: dc('postcode'),
      localita: dc('city'),
      provincia: dc('state'),
      // Paese: ISO se c'e' (consegna o cliente); altrimenti il nome esteso, che normalizzaPaese mappa.
      country: v(r, 'delivery_country_iso') || v(r, 'customers_country_iso') || v(r, 'delivery_country') || v(r, 'customers_country'),
      telefono: v(r, 'customers_telephone'),   // Spartoo non ha un telefono di consegna separato
      order_id: v(r, 'orders_id'),
      totale_ordine: v(r, 'order_total'),
      // Prodotto della riga (serve al raggruppamento multi-riga + riepilogo articoli).
      lineitem_name: v(r, 'products_name'),
      quantita: v(r, 'products_qty') || '1',
      variante: [v(r, 'products_size'), v(r, 'products_color')].filter(Boolean).join(' · '),
    })
  }
  return out
}
