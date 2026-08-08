import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Le notifiche MIRATE al cliente (consegna, giacenza, contrassegno) nascono a ogni evento: a regime
// sono migliaia al giorno. La campanella ne mostra le ultime 20, quindi le vecchie non servono più.
// Qui si tagliano quelle mirate più vecchie di 90 giorni, così la tabella resta piccola senza toccare
// le letture (indicizzate + limit 20). I BROADCAST (cliente_id vuoto, scritti a mano dal master)
// restano: sono pochi e li gestisce lui.
const GIORNI = 90

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - GIORNI * 24 * 60 * 60 * 1000).toISOString()
  const { error, count } = await admin.from('notifiche')
    .delete({ count: 'exact' })
    .not('cliente_id', 'is', null)
    .lt('created_at', soglia)
  if (error) {
    console.error('[PULIZIA-NOTIFICHE] fallita:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, eliminate: count || 0 })
}
