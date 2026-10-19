import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
import { COLONNE_PAGAMENTO, assorbitiDelCliente, componiPacco, contrassegnoDi } from '@/lib/ordini-uniti'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const piattaforma = new URL(req.url).searchParams.get('piattaforma') || 'shopify'
  // Colonne esplicite: escludo 'raw' (JSON completo dell'ordine, pesante e inutile in lista) MA
  // estraggo dal raw i soli campi-DATA (stringhe minuscole) per calcolare la DATA REALE dell'ordine:
  // eBay=creationDate, Woo=date_created, Shopify=created_at, TikTok/Temu=create_time (epoch),
  // PrestaShop=date_add. Prima la pagina ripiegava sulla data di IMPORT -> data/ora e ordinamento sbagliati.
  // Oltre alle date estraggo i campi del METODO DI PAGAMENTO: servono a riconoscere gli ordini in
  // CONTRASSEGNO e a precompilare l'importo COD sulla spedizione. Prima la pagina cercava questi
  // dati dentro `o.raw`, che pero' NON viene mai restituito qui (troppo pesante) -> il contrassegno
  // risultava sempre 0 e il cliente doveva riscriverlo a mano (segnalato su WooCommerce).
  // SOLO gli ordini di integrazioni ANCORA ESISTENTI: a ogni disconnetti/ricollega nasce una nuova
  // integrazione e la vecchia sparisce, ma i suoi ordini restano ORFANI in tabella -> senza questo
  // filtro comparivano duplicati con la data di IMPORT sbagliata (le righe sotto la vecchia connessione).
  const { data: integrs } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', utente.cliente_id).eq('piattaforma', piattaforma)
  const integrIds = (integrs || []).map((i: any) => i.id)
  if (!integrIds.length) return NextResponse.json([])
  const ordini = await fetchAll(() => supabase
    .from('ordini_ecommerce')
    .select(`id,integrazione_id,piattaforma,ordine_esterno_id,numero_ordine,cliente_nome,destinatario,articoli,totale,valuta,stato,stato_pagamento,spedizione_id,unito_in,fulfillment_stato,fulfillment_errore,created_at,d1:raw->>creationDate,d2:raw->>date_created,d3:raw->>created_at,d4:raw->>createdDate,d5:raw->>create_time,d6:raw->>date_add,d7:raw->>createdAt,d8:raw->>createdTime,${COLONNE_PAGAMENTO},n1:raw->>note,n2:raw->>customer_note`)
    .eq('cliente_id', utente.cliente_id)
    .eq('piattaforma', piattaforma)
    .in('integrazione_id', integrIds)
    .order('created_at', { ascending: false }))
  // DATA SPEDIZIONE = quando la spedizione l'abbiamo creata NOI. E' il secondo filtro della pagina
  // ("quando e' stato spedito"): uguale per tutti i canali e senza chiedere niente ai negozi. Lettura a
  // parte perche' spedizione_id non ha una FK (niente embed); la sessione del cliente, per RLS, vede
  // solo le sue spedizioni. A blocchi di 200 id per non allungare troppo la URL.
  const spedIds = Array.from(new Set((ordini as any[]).map((o: any) => o.spedizione_id).filter(Boolean)))
  const dataSpedizione = new Map<string, string>()
  for (let i = 0; i < spedIds.length; i += 200) {
    const { data } = await supabase.from('spedizioni').select('id,created_at').in('id', spedIds.slice(i, i + 200))
    for (const s of (data || [])) dataSpedizione.set(String(s.id), s.created_at)
  }
  const rows = (ordini as any[]).map(({ d1, d2, d3, d4, d5, d6, d7, d8, n1, n2, ...o }: any) => {
    let t: any = d1 || d2 || d3 || d4 || d5 || d6 || d7 || d8 || null   // d7 = Shopify createdAt (camelCase), d8 = Amazon createdTime
    // epoch (TikTok/Temu): secondi o millisecondi -> ISO
    if (t && /^\d{9,13}$/.test(String(t))) t = new Date(Number(t) * (String(t).length <= 10 ? 1000 : 1)).toISOString()
    // La nota dell'ordine si restituisce a parte: `raw` non esce mai da qui (pesante), ma questa
    // serve a chi spedisce — sono le istruzioni per il corriere. Shopify la chiama `note`, WooCommerce
    // `customer_note`: leggendo solo la prima, le note Woo non arrivavano mai alla spedizione
    // (1.416 ordini su 5.205 in 30 giorni, 19/10/2026: "citofono rotto", "lasciare al vicino"...).
    // CONTRASSEGNO: Woo payment_method 'cod', PrestaShop modulo cashondelivery, eBay paymentSummary
    // CASH_ON_DELIVERY/PICKUP. Importo = totale dell'ordine (lib/ordini-uniti).
    return { ...o, data_ordine: t || o.created_at, data_spedizione: o.spedizione_id ? (dataSpedizione.get(String(o.spedizione_id)) || null) : null, cod: contrassegnoDi(o), nota: n1 || n2 || null, metodo_pagamento: o.p2 || o.p1 || o.p4 || o.p3 || null }
  })

  // ORDINI UNITI: il capofila mostra e spedisce il PACCO — articoli, valore e note di tutti, e come
  // contrassegno la somma dei soli ordini in contrassegno (lib/ordini-uniti). Gli assorbiti si leggono a
  // parte per `unito_in`: possono stare sotto un'altra connessione del negozio, o fuori da questa lista.
  const colonneAssorbiti = `id,unito_in,created_at,articoli,totale,spedizione_id,stato_pagamento,${COLONNE_PAGAMENTO},n1:raw->>note,n2:raw->>customer_note`
  const assorbiti = await assorbitiDelCliente(supabase, utente.cliente_id, colonneAssorbiti)
  const conPacco = rows.map((o: any) => {
    const loro = o.unito_in ? null : assorbiti.get(String(o.id))
    if (!loro?.length) { const { p1, p2, p3, p4, p5, p6, ...resto } = o; return resto }
    const pacco = componiPacco(o, loro.map((r: any) => ({ ...r, nota: r.n1 || r.n2 || null })))
    const { p1, p2, p3, p4, p5, p6, ...resto } = o
    return { ...resto, articoli: pacco.articoli, totale: pacco.totale, cod: pacco.cod, nota: pacco.nota, ordini_uniti: loro.length, ordini_fuori_dal_pacco: pacco.fuori }
  })
  return NextResponse.json(conPacco)
}
