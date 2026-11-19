import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sentinellaOrfanePonte } from '@/lib/ponte-orfane'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON ogni 15 minuti: le gambe d'ingrosso rimaste senza la spedizione del cliente, perche' la creazione
// attraverso il ponte di condivisione si e' interrotta a meta' strada, si annullano con lo storno a ogni
// livello. Regole e limiti in lib/ponte-orfane.
// La risposta dice solo quanti pacchi: i numeri e i nomi vanno nei log, non a chi chiama il percorso.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  try {
    const r = await sentinellaOrfanePonte(createAdminSupabase())
    const conta = (e: string) => r.orfane.filter(o => o.esito === e).length
    return NextResponse.json({
      ok: !r.fermata, esaminate: r.esaminate, annullate: conta('annullata'), partite: conta('partita'),
      da_gestire: conta('da_gestire'), errori: conta('errore'), fermata: !!r.fermata,
    })
  } catch (e: any) {
    console.error('[PONTE][ORFANE] giro fallito', e?.message)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
