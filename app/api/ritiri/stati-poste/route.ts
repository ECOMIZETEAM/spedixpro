import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { rincorriRitiriPoste } from '@/lib/ritiro-codice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GIRO DEGLI STATI DEI RITIRI POSTE, ogni 10 minuti ai minuti 7, 17, 27…: lontano dai minuti del tracking
// di poste.it (bonifica-poste, 3/18/33/48), cosi' le due letture non si sommano. Ritmo e regole in lib/ritiro-codice.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const esito = await rincorriRitiriPoste(createAdminSupabase())
  if (esito.fermo) console.error('[RITIRO-POSTE] fermo:', esito.fermo, '| lette', esito.lette)
  if (esito.lette || Object.keys(esito.sconosciuti).length) {
    console.log('[RITIRO-POSTE] lette', esito.lette, 'su', esito.candidate, '| stati', JSON.stringify(esito.stati), '| non trovati', esito.nonTrovati, '| codici nuovi', JSON.stringify(esito.sconosciuti))
  }
  return NextResponse.json({ ok: true, ...esito })
}
