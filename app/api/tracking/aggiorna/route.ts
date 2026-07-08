import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, spediamoproSearchStocks, mapStatoSpediamopro } from '@/lib/spediamopro'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (ogni 4h): aggiorna lo stato delle spedizioni ancora "attive" leggendo il tracking
// dai corrieri. SpediamoPro: mappa lo status 0-13; lo status 11 (eccezione) → controlla gli
// stock: se c'è uno stock attivo → in_giacenza, altrimenti non_consegnato.
export async function GET() {
  const admin = createAdminSupabase()

  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,stato,raw_response,tracking_number,giacenza_data,corriere_id,corrieri(tipo,credenziali)')
    .not('stato', 'in', '(consegnata,annullata)')
    .order('updated_at', { ascending: true })
    .limit(300)

  let aggiornate = 0, errori = 0
  for (const s of (spedizioni || [])) {
    const corr: any = (s as any).corrieri
    if (corr?.tipo !== 'spediamopro') continue   // Spedisci.online: da aggiungere
    const raw: any = s.raw_response || {}
    const spid = raw.id || raw?.raw?.data?.id
    const authcode = (corr.credenziali as any)?.authcode
    if (!spid || !authcode) continue

    try {
      const tr = await spediamoproGetTracking(authcode, Number(spid))
      let nuovo = mapStatoSpediamopro(tr.status)

      if (nuovo === 'eccezione') {
        // distinguo giacenza (stock attivo) da altre eccezioni
        try {
          const stocks = await spediamoproSearchStocks(authcode, tr.shipmentCode || raw.code || String(spid))
          const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && Number(st.shipmentId) === Number(spid))
          nuovo = attivo ? 'in_giacenza' : 'non_consegnato'
        } catch { nuovo = 'non_consegnato' }
      }

      const upd: any = {}
      if (nuovo && nuovo !== s.stato) upd.stato = nuovo
      if (nuovo === 'in_giacenza' && !s.giacenza_data) upd.giacenza_data = new Date().toISOString()
      if (tr.trackingCode && tr.trackingCode !== s.tracking_number) upd.tracking_number = tr.trackingCode

      if (Object.keys(upd).length) {
        await admin.from('spedizioni').update(upd).eq('id', s.id)
        aggiornate++
      }
    } catch { errori++ }
  }

  return NextResponse.json({ ok: true, esaminate: spedizioni?.length || 0, aggiornate, errori })
}
