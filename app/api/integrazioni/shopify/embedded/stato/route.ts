import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { verifySessionTokenFromHeader } from '@/lib/shopifySessionToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stato dell'app embedded per il negozio autenticato via session token.
// Dice se il negozio è già collegato a un account MoovExpress (cliente) o meno.
export async function GET(req: NextRequest) {
  const claims = verifySessionTokenFromHeader(req.headers.get('authorization'))
  if (!claims) return NextResponse.json({ error: 'Session token non valido' }, { status: 401 })

  const admin = createAdminSupabase()
  const { data: integr } = await admin.from('integrazioni')
    .select('id,cliente_id,master_id,nome_negozio,stato,clienti(ragione_sociale)')
    .eq('piattaforma', 'shopify').eq('identificativo', claims.shop).maybeSingle()

  const collegato = !!integr?.cliente_id
  return NextResponse.json({
    shop: claims.shop,
    collegato,
    stato: integr?.stato || null,
    cliente: (integr as any)?.clienti?.ragione_sociale || null,
  })
}
