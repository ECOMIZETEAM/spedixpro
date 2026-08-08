import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sonda di SALUTE per i monitor esterni (uptime, alert): dice se l'app risponde e se il database è
// raggiungibile. Volutamente scarna — nessun dato interno, nessun conteggio — così può restare
// pubblica senza far trapelare nulla e senza pesare. 200 se tutto ok, 503 se il DB non risponde.
export async function GET() {
  const t0 = Date.now()
  let db = false
  try {
    const admin = createAdminSupabase()
    // Query leggerissima su una tabella piccola: conferma solo che il DB risponde.
    const { error } = await admin.from('masters').select('id').limit(1)
    db = !error
  } catch { db = false }
  return NextResponse.json(
    { ok: db, db: db ? 'up' : 'down', ms: Date.now() - t0 },
    { status: db ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
