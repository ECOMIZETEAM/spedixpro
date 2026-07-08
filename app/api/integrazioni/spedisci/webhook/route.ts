import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { mapStatoSpedisci } from '@/lib/spedisci'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Verifica la firma HMAC-SHA256 del webhook Spedisci.online.
// Firma = HMAC( `${timestamp}.${rawBody}` ) in hex; header: Webhook-Signature "t=<ts>,v1=<hex>".
function verifica(raw: string, timestamp: string | null, signature: string | null, secret: string): boolean {
  if (!timestamp || !signature) return false
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10)
  if (!Number.isFinite(age) || age > 300) return false
  const v1 = signature.split(',').find(p => p.startsWith('v1='))?.slice(3)
  if (!v1) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected)) } catch { return false }
}

// Mappa evento + stato Spedisci.online allo stato interno.
// Eventi reali del pannello: tracking.update, shipment.created, stock.created (giacenza), invoice.created.
function mapStato(event: string, statusStr: string): string | null {
  if (event === 'stock.created') return 'in_giacenza'   // Nuova giacenza
  const m = mapStatoSpedisci(statusStr)                  // tracking.update porta la stringa di stato
  if (m) return m
  return null   // shipment.created / invoice.created / stati non riconosciuti: non tocco
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const admin = createAdminSupabase()

  // Secret: dal DB (uno per ciascun account Spedisci) + fallback su env. Provo tutti finché uno verifica.
  const { data: righe } = await admin.from('webhook_secrets').select('secret').eq('provider', 'spedisci')
  const candidati = [...(righe || []).map((r: any) => r.secret), process.env.SPEDISCI_WEBHOOK_SECRET].filter(Boolean) as string[]
  if (!candidati.length) return new NextResponse('Webhook non configurato', { status: 500 })

  const ts = req.headers.get('webhook-timestamp')
  const sig = req.headers.get('webhook-signature')
  if (!candidati.some(sec => verifica(raw, ts, sig, sec))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: any
  try { body = JSON.parse(raw) } catch { return new NextResponse('Bad payload', { status: 200 }) }

  const event = body?.event || ''
  const d = body?.data || {}
  const tracking = d?.tracking_number || d?.tracking || d?.trackingNumber || d?.shipment?.tracking_number || d?.code
  if (!tracking) return new NextResponse('OK', { status: 200 })

  const nuovo = mapStato(event, d?.status || d?.stato || d?.description || '')
  if (nuovo) {
    const upd: any = { stato: nuovo }
    if (nuovo === 'in_giacenza') upd.giacenza_data = new Date().toISOString()
    // aggiorno tutte le spedizioni con quel tracking, ma non "declasso" quelle già consegnate/annullate
    await admin.from('spedizioni').update(upd)
      .eq('tracking_number', tracking)
      .not('stato', 'in', '(consegnata,annullata)')
  }

  return new NextResponse('OK', { status: 200 })
}
