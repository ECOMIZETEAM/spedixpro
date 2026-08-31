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
// Oltre questi tentativi FALLITI il retry si arrende su un ordine: e' un errore PERMANENTE (store giu' da
// giorni o, tipicamente, chiave store READ-ONLY che risponde 405 al write-back). ~8 giri da 20min = ~2h40
// di tentativi. Senza questo cap un ordine irrecuperabile veniva ritentato ogni 20min per 10 giorni,
// bruciando chiamate API allo store e occupando il budget di 1000 a scapito degli ordini recuperabili.
const MAX_TENTATIVI = 8

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  const { data: ordini } = await admin.from('ordini_ecommerce')
    .select('id,spedizione_id,fulfillment_stato,fulfillment_tentativi')
    .not('spedizione_id', 'is', null)
    .or('fulfillment_stato.is.null,fulfillment_stato.neq.ok')          // tutto tranne i già evasi
    .lt('fulfillment_tentativi', MAX_TENTATIVI)                         // salta gli irrecuperabili (cap raggiunto)
    .gte('created_at', new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: true })   // i PIÙ VECCHI prima: si svuota la coda, non si perdono gli arretrati
    .limit(1000)

  const candidati = (ordini || []).filter((o: any) => o.fulfillment_stato !== 'ok')
  const spedIds = Array.from(new Set(candidati.map((o: any) => o.spedizione_id)))
  if (!spedIds.length) return NextResponse.json({ ok: true, candidate: 0, evase: 0 })

  // Quali spedizioni hanno la LDV DEFINITIVA (verranno davvero tentate). Le PROVVISORIE non sono
  // fallimenti: aspettano solo la LDV vera (SpediamoPro/Poste async, anche 18h+), quindi NON devono
  // consumare tentativi — altrimenti un ordine legittimo si esaurirebbe solo perche' la LDV tarda.
  const { ldvProvvisoria } = await import('@/lib/numero-spedizione')
  const { data: sped } = await admin.from('spedizioni').select('id,tracking_number').in('id', spedIds)
  const prontiSet = new Set((sped || [])
    .filter((s: any) => s.tracking_number && !ldvProvvisoria(s.tracking_number)).map((s: any) => s.id))

  // fulfillMarketplace filtra da sé le LDV provvisorie e salta i già evasi.
  const esiti = await fulfillMarketplace(admin, spedIds)
  const ok = esiti.filter((e: any) => e?.stato === 'ok').length

  // Incremento il contatore SOLO per gli ordini PRONTI (davvero tentati) che DOPO il giro sono ancora
  // non-'ok': quelli sono fallimenti veri. Rileggo lo stato per non incrementare chi e' appena andato a
  // buon fine. Al raggiungimento del cap l'ordine esce dai retry (resta 'errore', ricreabile a mano).
  const prontiCand = candidati.filter((o: any) => prontiSet.has(o.spedizione_id))
  let esauriti = 0
  if (prontiCand.length) {
    const { data: dopo } = await admin.from('ordini_ecommerce')
      .select('id,fulfillment_stato').in('id', prontiCand.map((o: any) => o.id))
    const statoOra = new Map((dopo || []).map((o: any) => [o.id, o.fulfillment_stato]))
    for (const o of prontiCand) {
      if (statoOra.get(o.id) === 'ok') continue   // evaso in questo giro: non incremento
      const n = Number(o.fulfillment_tentativi || 0) + 1
      await admin.from('ordini_ecommerce').update({ fulfillment_tentativi: n }).eq('id', o.id)
      if (n >= MAX_TENTATIVI) esauriti++
    }
  }

  return NextResponse.json({ ok: true, candidate: spedIds.length, esiti: esiti.length, evase_ok: ok, esauriti })
}
