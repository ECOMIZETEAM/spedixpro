// IL PACCO DI UN'UNIONE SI CALCOLA, NON SI COPIA.
//
// Unire degli ordini (app/api/ordini/unisci) vuol dire spedirli in un pacco solo: il capofila parte,
// gli altri restano con `unito_in` che lo punta. Prima l'unione COPIAVA sul capofila gli articoli e il
// totale di tutti: ma il capofila e' anche l'ordine del negozio, e la sync lo riscrive con le sue sole
// righe (eBay: 9 capofila su 9 riscritti, 19/10/2026). Dopo la sync il pacco pesava e conteneva quanto il
// solo capofila. E il contrassegno era il totale di tutto il pacco se il capofila era in contrassegno, 0
// se non lo era — mai la parte giusta.
//
// Ora ogni riga resta il SUO ordine, aggiornato dalla sync (pesi compresi), e il pacco si compone qui,
// ogni volta, dagli ordini che lo formano:
//  - articoli: quelli di tutti, il capofila per primo;
//  - totale (valore della merce): la somma;
//  - contrassegno: la somma dei SOLI ordini in contrassegno. Regola di Lorenzo, 19/10/2026: un ordine
//    pagato da 100 € unito a uno in contrassegno da 90 € fa un pacco con contrassegno di 90 €.
//  - nota per il corriere: le note diverse di tutti gli ordini.

// CONTRASSEGNO = SOLDI: se non lo si riconosce, l'ordine risulta prepagato e non si incassa niente
// alla consegna. Oltre a 'cod'/'cash on delivery'/'contrassegno' si coprono gli slug dei gateway COD
// non standard (cod_advanced, wc_cod, cod-gateway…) con 'cod' come token o con separatore, e i termini
// in altre lingue (nachnahme DE, contre remboursement FR, contra reembolso ES).
const FIRMA_CONTRASSEGNO = /cash[\s_-]?on[\s_-]?(delivery|pickup)|cashondelivery|\bcod\b|[_-]cod\b|\bcod[_-]|contrassegn|(pagamento|paghi)[\s_]*(alla|in)?[\s_]*consegna|alla consegna|payment on delivery|nachnahme|contre[\s_-]?remboursement|contra[\s_-]?reembolso/i

// I campi del metodo di pagamento, estratti dal raw (che non si legge mai intero: e' pesante).
// Woo payment_method/payment_method_title, PrestaShop module/payment, eBay paymentSummary,
// Shopify paymentGatewayNames.
export const COLONNE_PAGAMENTO = 'p1:raw->>payment_method,p2:raw->>payment_method_title,p3:raw->>module,p4:raw->>payment,p5:raw->paymentSummary,p6:raw->paymentGatewayNames'

export function eInContrassegno(r: any): boolean {
  return FIRMA_CONTRASSEGNO.test(JSON.stringify([r?.p1, r?.p2, r?.p3, r?.p4, r?.p5, r?.p6]))
}

// Contrassegno del SOLO ordine della riga: il suo totale se e' in contrassegno, altrimenti niente.
export const contrassegnoDi = (r: any): number => eInContrassegno(r) ? (Number(r?.totale) || 0) : 0

// Raggruppa gli ordini assorbiti sotto il capofila IN CIMA: si seguono anche le catene (un capofila
// poi assorbito a sua volta, unioni fatte prima che si appiattissero). Servono id, unito_in, created_at.
export function perCapofila(assorbiti: any[]): Map<string, any[]> {
  const puntaA = new Map(assorbiti.map(r => [String(r.id), String(r.unito_in)]))
  const cima = (id: string) => { let c = puntaA.get(id)!; for (let i = 0; i < 10 && puntaA.has(c); i++) c = puntaA.get(c)!; return c }
  const m = new Map<string, any[]>()
  for (const r of assorbiti) { const c = cima(String(r.id)); if (!m.has(c)) m.set(c, []); m.get(c)!.push(r) }
  for (const righe of m.values()) righe.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  return m
}

// Tutti gli ordini assorbiti di un cliente: sono pochi (le unioni sono rare), una lettura sola.
export async function assorbitiDelCliente(db: any, clienteId: string, colonne: string): Promise<Map<string, any[]>> {
  const righe: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await db.from('ordini_ecommerce').select(colonne)
      .eq('cliente_id', clienteId).not('unito_in', 'is', null).order('id').range(da, da + 999)
    if (error) throw new Error('lettura ordini uniti: ' + error.message)
    righe.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  return perCapofila(righe)
}

// Gli assorbiti di capofila precisi (il riepilogo stampato: poche spedizioni alla volta). Si scende
// per livelli, cosi' si prendono anche le catene.
export async function assorbitiDi(db: any, capofilaIds: string[], colonne: string): Promise<Map<string, any[]>> {
  const trovati: any[] = []
  let livello = capofilaIds
  for (let giro = 0; giro < 5 && livello.length; giro++) {
    const prossimo: string[] = []
    for (let i = 0; i < livello.length; i += 200) {
      const { data, error } = await db.from('ordini_ecommerce').select(colonne).in('unito_in', livello.slice(i, i + 200))
      if (error) throw new Error('lettura ordini uniti: ' + error.message)
      for (const r of data || []) { trovati.push(r); prossimo.push(String(r.id)) }
    }
    livello = prossimo
  }
  return perCapofila(trovati)
}

// Un ordine che il negozio ha annullato o rimborsato dopo l'unione non parte e non si incassa: ne' la
// sua merce ne' il suo contrassegno entrano nel pacco. Lo stato del negozio e' in stato_pagamento
// (Woo lo rinfresca anche sulle righe unite: lib/wooSync).
const ANNULLATO_SUL_NEGOZIO = new Set(['cancelled', 'refunded', 'failed'])
const annullatoSulNegozio = (r: any) => ANNULLATO_SUL_NEGOZIO.has(String(r?.stato_pagamento || '').toLowerCase())

// Il pacco: capofila + assorbiti. Ogni riga porta i suoi articoli, totale, campi di pagamento, nota.
// Fuori dal pacco: gli assorbiti spediti a parte (hanno la loro spedizione: rimetterli qui li
// spedirebbe e incasserebbe due volte) e, per un pacco ancora da spedire, gli ordini annullati sul
// negozio. Il riepilogo di una spedizione gia' fatta li tiene: racconta cosa e' partito.
export function componiPacco(capo: any, assorbiti: any[], opz: { daSpedire?: boolean } = { daSpedire: true }) {
  const tutti = [capo, ...assorbiti.filter(r => !r.spedizione_id)].filter(r => !(opz.daSpedire && annullatoSulNegozio(r)))
  const note: string[] = []
  for (const r of tutti) { const n = String(r.nota || '').trim(); if (n && !note.includes(n)) note.push(n) }
  return {
    articoli: tutti.flatMap(r => Array.isArray(r.articoli) ? r.articoli : []),
    totale: Math.round(tutti.reduce((s, r) => s + (Number(r.totale) || 0), 0) * 100) / 100,
    cod: Math.round(tutti.reduce((s, r) => s + contrassegnoDi(r), 0) * 100) / 100,
    nota: note.join(' / ') || null,
    fuori: assorbiti.length + 1 - tutti.length,
  }
}
