import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { righeDaStimare, scriviStime } from '@/lib/network-stima'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// QUANTO RECUPERI, CALCOLATO APPENA LE RETTIFICHE ARRIVANO (lib/network-stima). Ogni 5 minuti: per ogni master, le
// rettifiche ricevute ancora da decidere senza stima, poi quelle con la stima piu' vecchia di un giorno (il listino del
// cliente nel frattempo puo' essere stato sistemato). Si smette di prendere righe nuove a 240 secondi: il resto al giro
// dopo. Solo letture, e su ogni riga la sola frase (rettifiche.perche.stima): nessun soldo si muove.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const finoA = Date.now() + 240 * 1000
  const { data: masters, error } = await admin.from('masters').select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const senza: string[] = [], vecchie: string[] = []
  for (const m of (masters || []) as any[]) {
    try {
      const x = await righeDaStimare(admin, m.id)
      senza.push(...x.senza); vecchie.push(...x.vecchie)
    } catch (e: any) { console.error('[STIMA] lettura', m.id, e?.message || e) }
  }
  let fatte = 0
  try {
    fatte = await scriviStime(admin, [...senza, ...vecchie], finoA)
  } catch (e: any) { console.error('[STIMA] calcolo:', e?.message || e) }
  return NextResponse.json({ ok: true, daStimare: senza.length, daRifare: vecchie.length, fatte })
}
