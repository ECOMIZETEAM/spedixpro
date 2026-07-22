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
  const ordini = await fetchAll(() => supabase
    .from('ordini_ecommerce')
    .select('id,integrazione_id,piattaforma,ordine_esterno_id,numero_ordine,cliente_nome,destinatario,articoli,totale,valuta,stato,stato_pagamento,spedizione_id,fulfillment_stato,fulfillment_errore,created_at,d1:raw->>creationDate,d2:raw->>date_created,d3:raw->>created_at,d4:raw->>createdDate,d5:raw->>create_time,d6:raw->>date_add')
    .eq('cliente_id', utente.cliente_id)
    .eq('piattaforma', piattaforma)
    .order('created_at', { ascending: false }))
  const rows = (ordini as any[]).map(({ d1, d2, d3, d4, d5, d6, ...o }: any) => {
    let t: any = d1 || d2 || d3 || d4 || d5 || d6 || null
    // epoch (TikTok/Temu): secondi o millisecondi -> ISO
    if (t && /^\d{9,13}$/.test(String(t))) t = new Date(Number(t) * (String(t).length <= 10 ? 1000 : 1)).toISOString()
    return { ...o, data_ordine: t || o.created_at }
  })
  return NextResponse.json(rows)
}
