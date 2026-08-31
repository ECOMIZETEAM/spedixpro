import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fulfillMarketplace } from '@/lib/fulfillMarketplace'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// RIEVASIONE DEGLI ORDINI MARKETPLACE RIMASTI INDIETRO.
//
// Il write-back verso lo store (Shopify/Woo/PrestaShop/eBay/TikTok/Temu) parte alla CHIUSURA DISTINTA,
// ma di proposito SALTA chi ha ancora la LDV provvisoria (fulfillMarketplace: non si manda al compratore
// un tracking finto) e resta 'errore' su un fallimento transitorio (store giù/lento, chiave read-only).
// Senza questo giro quegli ordini non verrebbero MAI evasi sullo store. Qui, ogni 20 min, si ripescano
// gli ordini NON ancora 'ok' e si ripassano a fulfillMarketplace, che (a) evade solo quelli con LDV
// ORMAI vera e (b) salta i già 'ok' (idempotente): così appena il cron scrive la LDV reale, l'evasione
// parte da sola, e i fallimenti transitori si ritentano.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  const { data: ordini } = await admin.from('ordini_ecommerce')
    .select('spedizione_id,fulfillment_stato')
    .not('spedizione_id', 'is', null)
    .or('fulfillment_stato.is.null,fulfillment_stato.neq.ok')          // tutto tranne i già evasi
    .gte('created_at', new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1000)

  const spedIds = Array.from(new Set(
    (ordini || []).filter((o: any) => o.fulfillment_stato !== 'ok').map((o: any) => o.spedizione_id)
  ))
  if (!spedIds.length) return NextResponse.json({ ok: true, candidate: 0, evase: 0 })

  // fulfillMarketplace filtra da sé le LDV provvisorie e salta i già evasi.
  const esiti = await fulfillMarketplace(admin, spedIds)
  const ok = esiti.filter((e: any) => e?.stato === 'ok').length
  return NextResponse.json({ ok: true, candidate: spedIds.length, esiti: esiti.length, evase_ok: ok })
}
