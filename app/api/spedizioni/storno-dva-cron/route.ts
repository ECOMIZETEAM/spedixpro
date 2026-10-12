import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { riconciliaStorniDvaCron } from '@/lib/storno-dva'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON: riconcilia le spedizioni DVA in 'storno_richiesto'. Lo storno di DVA e' ASINCRONO — alla
// richiesta resta "storno richiesto" finche' i loro operatori non verificano e cancellano davvero,
// riaccreditando. Qui si CHIEDE SOLO VERIFICA (niente storni nuovi): quando DVA risulta 'cancellato'
// si porta la spedizione a 'annullata' e si storna il credito a tutta la rete (rimborso idempotente).
// Chi resta 'storno richiesto' oltre il timeout finisce in coda manuale per revisione. Tutta la
// logica (batch per apikey, rimborso) sta in lib/storno-dva: qui solo l'autorizzazione e l'avvio.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const r = await riconciliaStorniDvaCron(admin)
  return NextResponse.json({ ok: true, ...r })
}
