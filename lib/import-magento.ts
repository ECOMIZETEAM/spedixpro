// PRE-NORMALIZZATORE DELL'EXPORT ORDINI MAGENTO 2 PER L'IMPORT ORDINI.
//
// Perche' a parte e non fra gli alias (come Shopify/Amazon/Temu): l'export griglia ordini di Magento 2
// (Vendite > Ordini > Esporta CSV) NON segue lo schema "un header = un campo" degli altri. Ha due
// scomodita' insieme:
//  1) l'indirizzo di spedizione e' un UNICO campo-blob ("Indirizzo di Spedizione") che dentro tiene
//     via, citta', provincia e CAP tutti insieme (comma o a-capo). Nessun alius singolo puo' spaccarlo;
//  2) il file e' lo STORICO COMPLETO: contiene tutti gli ordini di sempre, in stragrande maggioranza
//     gia' evasi ("Complete") o annullati ("Canceled"). Importarli creerebbe migliaia di spedizioni di
//     ordini gia' chiusi. Vanno presi SOLO quelli davvero da spedire.
//
// Soluzione (identica a Spartoo): riconosco il file e lo RIMAPPO sulle colonne CANONICHE del nostro
// import PRIMA dell'auto-mapping. Cosi' riusa la stessa pipeline (provincia-da-CAP, dedup, contrassegno)
// e NON tocco gli alias di Shopify/Amazon/Temu. Le canoniche vincono perche' sono la 1ª voce di ogni
// lista di alias.
//
// NB: gli header arrivano gia' normalizzati da normHeader (minuscolo, spazi->_, accenti tolti,
// parentesi/apostrofi rimossi): "Indirizzo di Spedizione"->indirizzo_di_spedizione, "Totale complessivo
// (acquistato)"->totale_complessivo_acquistato, "Nome Destinatario"->nome_destinatario.

// Solo questi stati sono "da spedire": ordine in preparazione o in attesa di lavorazione. Tutto il resto
// — gia' evaso (complete), annullato (canceled), chiuso/rimborsato (closed), pagamento non confermato
// (pending payment, holded/on hold) — si SALTA e si conta. E' la stessa scelta di Spartoo che salta gli
// annullati: evita di ri-spedire lo storico. Deny-list sarebbe pericolosa (uno stato custom sconosciuto
// entrerebbe): qui e' un'ALLOW-list stretta, cosi' nel dubbio non si spedisce.
const STATI_DA_SPEDIRE = new Set([
  'pending', 'processing',
  'in lavorazione', 'in elaborazione', 'elaborazione', 'da evadere', 'da spedire',
])

// Firma Magento: la tripletta indirizzo-di-spedizione + punto-di-acquisto + nome-destinatario non
// esiste in nessun altro export (Shopify/Amazon/Temu/Spartoo/nostro template) -> niente falsi positivi.
// Copro anche l'export in inglese (shipping_address / purchase_point / shipto_name).
export function eMagento(r0: Record<string, string> | undefined): boolean {
  if (!r0) return false
  const k = new Set(Object.keys(r0))
  const haInd = k.has('indirizzo_di_spedizione') || k.has('shipping_address')
  const haPunto = k.has('punto_di_acquisto') || k.has('purchase_point')
  const haNome = k.has('nome_destinatario') || k.has('shipto_name') || k.has('shipto_name_')
  return haInd && haPunto && haNome
}

// Parsa il blob indirizzo Magento in via/citta'/provincia/CAP/telefono/paese. Regge i due formati che
// Magento produce a seconda della configurazione del negozio:
//   A) piatto:      "via, citta, provincia, CAP"
//   B) multilinea:  "via\ncitta, REGIONE CAP\nItaly\nT: telefono"
// Strategia robusta a entrambi: separo su virgola E a-capo, tolgo il paese e il "T: telefono", poi trovo
// il PRIMO pezzo che contiene un CAP (4-5 cifre). Il CAP e' la chiave: la provincia vera la ricava il
// chiamante dal CAP (i "region" Magento sono spesso sbagliati, es. "Aosta" per un CAP di Modena).
const PAESI_NOTI = /^(italy|italia|it|france|francia|deutschland|germania|germany|espana|spagna|spain|svizzera|switzerland|suisse)$/i
export function parseIndirizzoMagento(blob: string, nome: string): {
  indirizzo: string; localita: string; cap: string; telefono: string; country: string
} {
  let country = ''
  let telefono = ''
  const grezzi = String(blob || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
  const tokens: string[] = []
  for (const t of grezzi) {
    const mTel = t.match(/^T\.?:?\s*(.+)$/i)      // "T: 333..." = telefono
    if (mTel && /\d/.test(mTel[1])) { telefono = mTel[1].trim(); continue }
    if (PAESI_NOTI.test(t)) { country = t; continue }
    tokens.push(t)
  }
  // La 1ª riga a volte e' il NOME del destinatario (non parte dell'indirizzo): tolgola se coincide.
  if (tokens.length > 1 && nome && tokens[0].toLowerCase() === nome.trim().toLowerCase()) tokens.shift()

  // Trovo il pezzo col CAP.
  let ci = -1, cap = ''
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/\b(\d{5}|\d{4})\b/)
    if (m) { cap = m[1]; ci = i; break }
  }
  if (ci < 0) {
    // Nessun CAP: restituisco tutto come via (la riga verra' segnalata "manca CAP" e corretta a mano).
    return { indirizzo: tokens.join(', '), localita: '', cap: '', telefono, country }
  }
  // Nel pezzo del CAP puo' esserci anche la provincia/regione ("RM 00185") o la citta': quel che resta
  // tolto il CAP e' provincia/regione (la scarto: la provincia la fa il CAP), la citta' e' il pezzo prima.
  const restoCap = tokens[ci].replace(/\b(\d{5}|\d{4})\b/, '').trim()
  const localita = restoCap ? (tokens[ci - 1] || '') : (tokens[ci - 1] || '')
  // Se il pezzo-CAP conteneva SOLO il CAP (formato A: "..., citta, provincia, CAP"), allora provincia =
  // tokens[ci-1] e citta' = tokens[ci-2]; se conteneva "REGIONE CAP" (formato B), citta' = tokens[ci-1].
  let cittaFin: string, viaFin: string
  if (restoCap) {
    cittaFin = tokens[ci - 1] || ''
    viaFin = tokens.slice(0, Math.max(0, ci - 1)).join(', ')
  } else {
    cittaFin = tokens[ci - 2] || tokens[ci - 1] || ''
    viaFin = tokens.slice(0, Math.max(0, ci - 2)).join(', ')
  }
  return { indirizzo: viaFin.trim(), localita: cittaFin.trim(), cap, telefono, country: country || '' }
}

// Rimappa le righe Magento sulle colonne canoniche. Tiene le originali e AGGIUNGE le canoniche (che
// vincono nell'auto-mapping). Salta gli ordini NON da spedire (evasi/annullati/chiusi/non pagati).
export function rimappaMagento(rows: Record<string, string>[]): Record<string, string>[] {
  const v = (r: any, ...keys: string[]) => { for (const k of keys) { const x = String(r?.[k] ?? '').trim(); if (x) return x } return '' }
  const out: Record<string, string>[] = []
  for (const r of rows) {
    const stato = v(r, 'stato', 'status').toLowerCase()
    if (!STATI_DA_SPEDIRE.has(stato)) continue

    const nome = v(r, 'nome_destinatario', 'shipto_name', 'shipto_name_')
    const blob = v(r, 'indirizzo_di_spedizione', 'shipping_address')
    const ind = parseIndirizzoMagento(blob, nome)
    // Paese: se il blob nomina un paese estero lo normalizza il chiamante; default Italia.
    const paese = ind.country || 'IT'

    out.push({
      ...r,
      destinatario: nome,
      indirizzo: ind.indirizzo,
      cap: ind.cap,
      localita: ind.localita,
      // Provincia VUOTA di proposito: nell'export Magento il "region" e' spesso incoerente col CAP; la
      // pipeline la ricava dal CAP (CAP_PROVINCIA + storico), che e' la fonte affidabile. Vedi la route.
      provincia: '',
      country: paese,
      telefono: ind.telefono,
      email_destinatario: v(r, 'email_cliente', 'customer_email'),
      order_id: v(r, 'id', 'order_id', 'increment_id'),
      totale_ordine: v(r, 'totale_complessivo_acquistato', 'totale', 'grand_total_purchased', 'totale_complessivo_base'),
      // Metodo di pagamento passato COSI' com'e': la route decide il contrassegno con la sua logica
      // gia' testata (isCod). Per questo negozio sono tutti prepagati (PayPal/Nexi) -> nessun COD.
      metodo_pagamento: v(r, 'metodo_di_pagamento', 'payment_method'),
    })
  }
  return out
}
