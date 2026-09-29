import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// IL COSTO DI RESI E GIACENZE, TUTTI I GIORNI.
//
// Le ripesature il costo lo scalano quando si carica il file. Reso e apertura giacenza no: il
// corriere li addebita sul conto e nessuno li registrava, cosi' chi detiene il contratto incassava
// dalla rete senza mai pagare il corriere (2.795,09 EUR di resi e 313,95 di giacenze dal 2/07 al
// 29/09/2026). Qui si rilegge il conto e si scala quello che manca.
//
// `pagine` dice quanto si va indietro: trenta (3.000 righe) coprono due-tre giorni abbondanti, cosi'
// un giro saltato si recupera da solo al giro dopo. Rifarlo non fa danni: il doppio addebito lo
// impedisce l'indice unico sul riferimento, non l'ordine in cui girano le cose.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const pagine = Math.max(1, Math.min(1000, Number(new URL(req.url).searchParams.get('pagine')) || 30))
  const admin = createAdminSupabase()
  try {
    const { riconciliaCostiConto } = await import('@/lib/conto-fornitore')
    const esito = await riconciliaCostiConto(admin, { pagine })
    if (esito.scritti) console.log('[CONTO] costi scalati', esito.scritti, 'per', esito.euro.toFixed(2), 'EUR')
    return NextResponse.json({ ok: true, ...esito })
  } catch (e: any) {
    console.error('[CONTO] riconciliazione non riuscita:', e?.message)
    return NextResponse.json({ ok: false, errore: String(e?.message || e) }, { status: 500 })
  }
}
