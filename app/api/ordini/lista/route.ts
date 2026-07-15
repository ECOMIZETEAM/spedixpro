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
  // Colonne esplicite: escludo 'raw' (JSON completo dell'ordine, pesante e inutile in lista)
  const ordini = await fetchAll(() => supabase
    .from('ordini_ecommerce')
    .select('id,integrazione_id,piattaforma,ordine_esterno_id,numero_ordine,cliente_nome,destinatario,articoli,totale,valuta,stato,stato_pagamento,spedizione_id,fulfillment_stato,fulfillment_errore,created_at')
    .eq('cliente_id', utente.cliente_id)
    .eq('piattaforma', piattaforma)
    .order('created_at', { ascending: false }))
  return NextResponse.json(ordini)
}
