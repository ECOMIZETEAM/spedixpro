import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { rincorriCodiciRitiro } from '@/lib/ritiro-codice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GIRO DEL CODICE RITIRO, ogni 2 minuti: va a prendere presso il fornitore i codici di ritiro arrivati
// dopo la creazione della spedizione (il perche' e le cadenze sono in lib/ritiro-codice).
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const esito = await rincorriCodiciRitiro(admin, { budgetMs: 40000 })
  if (esito.trovati || esito.errori) {
    console.log('[RITIRO-CODICE] trovati', esito.trovati, '| errori', esito.errori, '| chieste', esito.chieste, 'su', esito.candidate, '| senza codice:', JSON.stringify(esito.testi))
  }
  return NextResponse.json({ ok: true, ...esito })
}
