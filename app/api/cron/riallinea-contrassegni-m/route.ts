import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { riallineaContrassegniMEcomize } from '@/lib/contrassegni-m-ecomize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SELF-HEAL del contrassegno Poste Express M (clienti Ecomize): ri-deriva l'M dall'S e riscrive SOLO
// i listini fuori regola (+1,5% sul top). A regime non tocca niente. Serve perché un salvataggio del
// listino dal portale riscrive i contrassegni SENZA l'1,5% e lo perde. Vedi lib/contrassegni-m-ecomize.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  try {
    const r = await riallineaContrassegniMEcomize(admin)
    if (r.riallineati) console.log('[RIALLINEA-CONTRASSEGNI-M]', r.riallineati, 'riallineati:', JSON.stringify(r.dettaglio).slice(0, 3000))
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[RIALLINEA-CONTRASSEGNI-M] fallito:', e?.message)
    return NextResponse.json({ error: e?.message || 'errore' }, { status: 500 })
  }
}
