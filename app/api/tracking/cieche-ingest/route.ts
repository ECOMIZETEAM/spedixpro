import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester } from '@/lib/ripesature-harvester'
import { prioritaStato } from '@/lib/spedisci'
import { eventiDaFullTracking } from '@/lib/tracking-poste'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Riceve dallo script locale il full-tracking OneTracking di un lotto di LDV cieche e scrive la
// cronologia + avanza lo stato SOLO-AVANTI (mai declassare, terminali intoccabili, reso appiccicoso).
// NON tocca giacenza_data: un backfill di una giacenza vecchia datandola "ora" falserebbe l'addebito
// a giornate — le giacenze restano al flusso normale del webhook/cron.
// body: { righe: [{ spedizione_id, ldv, tracking: [...] }] }  (tracking = array `tracking` del full-tracking)
export async function POST(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const righe = Array.isArray(body?.righe) ? body.righe : []
  let cronologie = 0, avanzati = 0, vuote = 0
  for (const r of righe) {
    const sid = r?.spedizione_id
    if (!sid) continue
    const eventi = eventiDaFullTracking(r?.tracking || [])
    if (!eventi.length) { vuote++; continue }
    const { data: sp } = await admin.from('spedizioni').select('stato').eq('id', sid).maybeSingle()
    if (!sp) continue
    // Sostituisco la cronologia (arriva completa: niente duplicati) e riallineo lo stato.
    await admin.from('tracking_events').delete().eq('spedizione_id', sid)
    await admin.from('tracking_events').insert(eventi.map((e) => ({ spedizione_id: sid, ...e })))
    cronologie++
    let avanzato: string | null = null
    for (const e of eventi) if (e.stato && prioritaStato(e.stato) > prioritaStato(avanzato)) avanzato = e.stato
    if (avanzato && (sp as any).stato !== 'consegnata' && (sp as any).stato !== 'annullata'
        && prioritaStato(avanzato) > prioritaStato((sp as any).stato)
        && !((sp as any).stato === 'reso_mittente' && avanzato === 'consegnata')) {
      await admin.from('spedizioni').update({ stato: avanzato }).eq('id', sid)
      avanzati++
    }
  }
  return NextResponse.json({ ok: true, cronologie, avanzati, vuote })
}
