import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { verifySessionTokenFromHeader } from '@/lib/shopifySessionToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lista ordini importati per il negozio embedded (autenticato dal session token).
export async function GET(req: NextRequest) {
  const claims = verifySessionTokenFromHeader(req.headers.get('authorization'))
  if (!claims) return NextResponse.json({ error: 'Session token non valido' }, { status: 401 })

  const admin = createAdminSupabase()
  const { data: integr } = await admin.from('integrazioni').select('id')
    .eq('piattaforma', 'shopify').eq('identificativo', claims.shop).maybeSingle()
  if (!integr) return NextResponse.json({ ordini: [] })

  const { data: ordini } = await admin.from('ordini_ecommerce')
    .select('id,numero_ordine,cliente_nome,destinatario,articoli,totale,valuta,stato_pagamento,spedizione_id,fulfillment_stato,created_at')
    .eq('integrazione_id', integr.id).order('created_at', { ascending: false }).limit(100)

  return NextResponse.json({ ordini: ordini || [] })
}
