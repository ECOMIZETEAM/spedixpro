import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { smaltisciCodaManualeDva } from '@/lib/storno-dva'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON TEMPORANEO (una-tantum): smaltisce il backlog storico delle LDV DVA finite in coda manuale
// quando l'annullo si faceva a mano. Ora c'e' la richiesta-storno: questo passaggio le ripassa tutte
// dal flusso automatico, a blocchi (vedi smaltisciCodaManualeDva). Ammesso -> 'storno_richiesto' (il
// credito si storna solo a conferma DVA, via storno-dva-cron); non stornabili restano in coda col
// motivo. Quando 'residuo' arriva a 0 il backlog e' esaurito e questo cron va rimosso da vercel.json.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const r = await smaltisciCodaManualeDva(admin, 150)
  console.log('[STORNO-DVA][BACKLOG]', JSON.stringify(r))
  return NextResponse.json({ ok: true, ...r })
}
