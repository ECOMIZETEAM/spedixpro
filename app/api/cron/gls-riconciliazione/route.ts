import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// OGNI NOTTE: confronto fra il registro di ogni conto GLS e il portale (lib/gls-riconciliazione).
// Le spedizioni che non tornano le vede il master che detiene il contratto, in Spedizioni Cancellate.
// `giorni` quanto si va indietro (14 di solito: una spedizione nata più di due settimane fa, se non
// torna, l'ha già trovata un giro precedente). Rifarlo non fa danni: una riga per spedizione.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const giorni = Math.max(1, Math.min(35, Number(new URL(req.url).searchParams.get('giorni')) || 14))
  const admin = createAdminSupabase()
  try {
    const { riconciliaContiGls } = await import('@/lib/gls-riconciliazione')
    const esito = await riconciliaContiGls(admin, { giorni, scrivi: true })
    for (const c of esito.contiNonLeggibili) console.warn('[GLS][RICONCILIA] registro non leggibile:', c.conto, '-', c.motivo)
    for (const t of esito.trovate) console.log('[GLS][RICONCILIA]', t.tipo, t.tracking_number)
    const { trovate, ...conteggi } = esito
    return NextResponse.json({ ok: true, ...conteggi, trovate: trovate.length })
  } catch (e: any) {
    console.error('[GLS][RICONCILIA] errore:', e?.message || e)
    return NextResponse.json({ ok: false, error: e?.message || 'errore' }, { status: 500 })
  }
}
