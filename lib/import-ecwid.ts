// PRE-NORMALIZZATORE DELL'EXPORT ORDINI DI ECWID PER L'IMPORT ORDINI.
//
// Perche' a parte e non fra gli alias (come Magento e Spartoo): l'export di Ecwid (Ordini → Esporta,
// CSV con ';') usa nomi che per gli altri formati vogliono dire un'altra cosa, e metterli fra gli
// alias romperebbe l'uno o l'altro:
//  - `name` e' il NOME DEL PRODOTTO, mentre fra gli alias e' il numero d'ordine (Shopify "Name" = #1001):
//    l'ordine 120 diventerebbe "Saremo amiche sempre...";
//  - `total` e' il totale della RIGA, non dell'ordine: il totale vero e' `order_total`, gia' scontato
//    dal coupon (ordine CBUJW del primo file: righe 32+8+8+8 = 56, pagato 39,20). E' l'importo che va
//    incassato se l'ordine e' in contrassegno;
//  - `sku` c'e' ma e' quasi sempre vuoto, e fra gli alias e' il primo candidato per il prodotto della
//    riga: gli articoli sparirebbero dal contenuto e dal riepilogo;
//  - ogni riga RIPETE tutto l'ordine (indirizzo, totali): il totale va contato una volta sola, perche'
//    l'import somma la colonna del totale su tutte le righe dello stesso ordine (vedi la rotta);
//  - nel file ci sono anche ordini gia' spediti, consegnati o annullati.
//
// Soluzione (identica a Magento e Spartoo): riconosco il file e lo RIMAPPO sulle colonne CANONICHE del
// nostro import PRIMA dell'auto-mapping, cosi' riusa la stessa pipeline (raggruppamento multi-riga,
// provincia-da-CAP, estero, dedup, contrassegno) e NON tocco gli alias degli altri negozi. Le canoniche
// vincono perche' sono la prima voce di ogni lista di alias.
//
// NB: gli header arrivano gia' normalizzati da normHeader (minuscolo, spazi->_): "shipto_person_name",
// "order_number", "fulfillment_status_code"... restano come sono.

// Firma Ecwid: le colonne shipto_person_* insieme a order_number non le produce nessun altro export
// (Shopify, Amazon, Temu, Magento, Spartoo, nostro template) -> niente falsi positivi.
export function eEcwid(r0: Record<string, string> | undefined): boolean {
  if (!r0) return false
  const k = new Set(Object.keys(r0))
  return k.has('order_number') && k.has('shipto_person_name') && k.has('shipto_person_postal_code')
}

// QUALI ORDINI SI IMPORTANO. Allow-list stretta, come Magento: nel dubbio non si spedisce.
//  - evasione: solo quelli ancora da preparare. NEW e' il codice storico di "In attesa di elaborazione"
//    (lo usa il primo file arrivato); AWAITING_PROCESSING e PROCESSING quelli attuali. Spediti,
//    consegnati, resi, "non verra' consegnato" e "pronto per il ritiro" (lo ritira il cliente in
//    negozio) restano fuori.
//  - pagamento: fuori gli annullati, i rimborsati e gli incompleti (carrello mai pagato). "In attesa di
//    pagamento" entra SOLO se l'ordine e' in contrassegno, dove e' normale che non sia ancora pagato:
//    un bonifico non ancora arrivato non si spedisce (stessa scelta di Magento, che salta il "pending
//    payment"). ACCEPTED e' il codice storico di "Pagato".
const EVASIONE_DA_SPEDIRE = new Set(['NEW', 'AWAITING_PROCESSING', 'PROCESSING'])
const PAGAMENTO_FUORI = new Set(['CANCELLED', 'REFUNDED', 'INCOMPLETE'])

// Il contrassegno su Ecwid e' un metodo di pagamento con un nome scelto dal negozio: "Contrassegno",
// "Pagamento alla consegna", "Cash on delivery". La rotta riconosce solo i primi e l'inglese, quindi qui
// si decide per Ecwid e si scrive l'importo nella colonna canonica.
const eContrassegno = (metodo: string) => /contrassegn|alla\s+consegna|cash\s*on\s*delivery|\bcod\b/i.test(metodo || '')

export type OrdineEcwidSaltato = { riga: number; ordine: string; motivo: string }

// Rimappa le righe Ecwid sulle colonne canoniche. Tiene le originali (finiscono in `raw`) e AGGIUNGE le
// canoniche, tranne `sku`: quella colonna si toglie e lo SKU va in `codice_sku`, perche' come `sku`
// verrebbe scelta prima del nome come prodotto della riga (ed e' quasi sempre vuota). `codice_sku` resta
// lo SKU per l'abbinamento col catalogo dei pacchi e degli articoli.
// Torna anche gli ordini saltati, col motivo: la pagina li elenca fra le righe non importate.
export function rimappaEcwid(rows: Record<string, string>[]): { righe: Record<string, string>[]; saltati: OrdineEcwidSaltato[] } {
  const v = (r: any, ...keys: string[]) => { for (const k of keys) { const x = String(r?.[k] ?? '').trim(); if (x) return x } return '' }
  const righe: Record<string, string>[] = []
  const saltati: OrdineEcwidSaltato[] = []
  const totaleGiaContato = new Set<string>()
  const saltatoGiaDetto = new Set<string>()

  rows.forEach((r, i) => {
    const ordine = v(r, 'order_number')
    const evasione = v(r, 'fulfillment_status_code').toUpperCase()
    const pagamento = v(r, 'payment_status_code').toUpperCase()
    const metodo = v(r, 'payment_method')
    const cod = eContrassegno(metodo)

    let motivo = ''
    if (evasione && !EVASIONE_DA_SPEDIRE.has(evasione)) motivo = `su Ecwid risulta "${v(r, 'fulfillment_status') || evasione}"`
    else if (PAGAMENTO_FUORI.has(pagamento)) motivo = `pagamento "${v(r, 'payment_status') || pagamento}"`
    else if (pagamento === 'AWAITING_PAYMENT' && !cod) motivo = `in attesa di pagamento (${metodo || 'metodo non indicato'}): si importa quando risulta pagato`
    if (motivo) {
      // Un motivo per ordine, non per riga: un ordine da cinque prodotti e' una riga sola nell'elenco.
      if (!saltatoGiaDetto.has(ordine)) { saltatoGiaDetto.add(ordine); saltati.push({ riga: i + 2, ordine, motivo }) }
      return
    }

    // Indirizzo di SPEDIZIONE, con ripiego su quello di fatturazione quando la spedizione e' vuota.
    const sp = (campo: string) => v(r, 'shipto_person_' + campo) || v(r, 'bill_person_' + campo)
    // Il totale dell'ordine su UNA riga sola: la rotta somma la colonna su tutte le righe dello stesso
    // ordine, e ogni riga Ecwid ripete l'intero order_total.
    const primaRiga = !totaleGiaContato.has(ordine)
    if (ordine) totaleGiaContato.add(ordine)
    const totale = primaRiga ? v(r, 'order_total') : ''
    // Peso: quello dell'ordine, se il negozio lo compila. 0 = non indicato (si prezza su 1 kg e la pagina
    // lo dice), non un collo da zero chili.
    const pesoOrdine = v(r, 'order_weight')
    const peso = Number(pesoOrdine.replace(',', '.')) > 0 ? pesoOrdine : ''

    const { sku, ...resto } = r
    righe.push({
      ...resto,
      codice_sku: String(sku ?? '').trim(),
      destinatario: sp('name'),
      indirizzo: sp('street_1'),
      indirizzo2: sp('street_2'),
      cap: sp('postal_code'),
      localita: sp('city'),
      provincia: sp('state_code') || sp('state_name'),
      country: sp('country_code') || sp('country_name'),
      // " +393386409499": Ecwid lo esporta con uno spazio davanti.
      telefono: sp('phone'),
      email_destinatario: v(r, 'email'),
      order_id: ordine,
      totale_ordine: totale,
      // L'importo da incassare e' il totale pagato dell'ordine, ancora una volta su una riga sola.
      contrassegno: cod && primaRiga ? v(r, 'order_total') : '',
      note: v(r, 'order_comments'),
      peso,
      // Il prodotto della riga: nome, quantita' e opzioni (taglia, colore...) per contenuto e riepilogo.
      lineitem_name: v(r, 'name') || String(sku ?? '').trim(),
      quantita: v(r, 'quantity') || '1',
      variante: v(r, 'options'),
      // Lo stato del pagamento non decide il contrassegno: lo decide il metodo, qui sopra. Senza questa
      // colonna vuota la rotta leggerebbe `payment_status` di Ecwid.
      financial_status: '',
    })
  })
  return { righe, saltati }
}
