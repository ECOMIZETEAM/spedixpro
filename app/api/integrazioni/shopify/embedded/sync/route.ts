import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { verifySessionTokenFromHeader } from '@/lib/shopifySessionToken'
import { sincronizzaOrdiniShopify } from '@/lib/shopifySync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sync ordini dall'app EMBEDDED (autenticata dal session token, non dal login).
export async function POST(req: NextRequest) {
  const claims = verifySessionTokenFromHeader(req.headers.get('authorization'))
  if (!claims) return NextResponse.json({ error: 'Session token non valido' }, { status: 401 })

  const admin = createAdminSupabase()
  const { data: integr } = await admin.from('integrazioni').select('*')
    .eq('piattaforma', 'shopify').eq('identificativo', claims.shop).maybeSingle()
  if (!integr?.cliente_id) return NextResponse.json({ error: 'Negozio non collegato' }, { status: 404 })

  try {
    const res = await sincronizzaOrdiniShopify(admin, integr)
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore sincronizzazione' }, { status: 502 })
  }
}
