import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'

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
  const ordini = await fetchAll(() => supabase
    .from('ordini_ecommerce')
    .select('id,integrazione_id,piattaforma,ordine_esterno_id,numero_ordine,cliente_nome,destinatario,articoli,totale,valuta,stato,stato_pagamento,spedizione_id,fulfillment_stato,fulfillment_errore,created_at,d1:raw->>creationDate,d2:raw->>date_created,d3:raw->>created_at,d4:raw->>createdDate,d5:raw->>create_time,d6:raw->>date_add,p1:raw->>payment_method,p2:raw->>payment_method_title,p3:raw->>module,p4:raw->>payment,p5:raw->paymentSummary')
    .eq('cliente_id', utente.cliente_id)
    .eq('piattaforma', piattaforma)
    .order('created_at', { ascending: false }))
  const rows = (ordini as any[]).map(({ d1, d2, d3, d4, d5, d6, p1, p2, p3, p4, p5, ...o }: any) => {
    let t: any = d1 || d2 || d3 || d4 || d5 || d6 || null
    // epoch (TikTok/Temu): secondi o millisecondi -> ISO
    if (t && /^\d{9,13}$/.test(String(t))) t = new Date(Number(t) * (String(t).length <= 10 ? 1000 : 1)).toISOString()
    // CONTRASSEGNO: Woo payment_method 'cod' (titolo "Pagamento alla consegna"), PrestaShop modulo
    // cashondelivery, eBay paymentSummary CASH_ON_DELIVERY/PICKUP. Importo = totale dell'ordine.
    const firma = JSON.stringify([p1, p2, p3, p4, p5])
    const isCod = /cash[\s_-]?on[\s_-]?(delivery|pickup)|cashondelivery|"cod"|\bcontrassegn|pagamento alla consegna|alla consegna/i.test(firma)
    const cod = isCod ? (Number(o.totale) || 0) : 0
    return { ...o, data_ordine: t || o.created_at, cod, metodo_pagamento: p2 || p1 || p4 || p3 || null }
  })
  return NextResponse.json(rows)
}
