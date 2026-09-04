import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { aggiornaGlsSpedisci } from '@/lib/gls-tracking-pubblico'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON: aggiorna il tracking delle spedizioni GLS-via-spedisci dal tracking PUBBLICO di GLS.
// Serve perche' per alcuni account spedisci il webhook non consegna (secret non nostro, non leggibile
// via API) e il polling tracking di spedisci e' chiuso. Round-robin per tracking_check_at.
// MONEY-SAFE: non tocca mai giacenza_data (nessun addebito) — vedi lib/gls-tracking-pubblico.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '200'), 1), 500)
  const dryRun = url.searchParams.get('dry') === '1'
  const admin = createAdminSupabase()
  const res = await aggiornaGlsSpedisci(admin, { limit, dryRun })
  console.log('[TRACKING][GLS-SPEDISCI]', JSON.stringify(res.cambi ? { ...res, cambi: res.cambi.length } : res))
  return NextResponse.json(res)
}
