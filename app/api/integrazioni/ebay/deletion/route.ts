import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Endpoint per la "Marketplace Account Deletion/Closure Notification" di eBay.
// Obbligatorio per abilitare il keyset Production.
//  - GET  (challenge): eBay invia ?challenge_code=... e si aspetta
//        SHA256(challengeCode + verificationToken + endpointUrl) in hex.
//  - POST (notifica):  eBay avvisa quando un utente chiede la cancellazione;
//        rispondiamo 200 e cancelliamo (best-effort) i dati collegati.

const VERIF = process.env.EBAY_VERIFICATION_TOKEN || ''

function endpointUrl(req: NextRequest): string {
  // Deve combaciare ESATTAMENTE con l'URL registrato su eBay.
  return process.env.EBAY_DELETION_ENDPOINT || `${new URL(req.url).origin}/api/integrazioni/ebay/deletion`
}

export async function GET(req: NextRequest) {
  const challenge = new URL(req.url).searchParams.get('challenge_code')
  if (!challenge) return NextResponse.json({ error: 'missing challenge_code' }, { status: 400 })
  if (!VERIF) return NextResponse.json({ error: 'verification token non configurato' }, { status: 500 })

  const hash = crypto.createHash('sha256')
  hash.update(challenge)
  hash.update(VERIF)
  hash.update(endpointUrl(req))
  return NextResponse.json({ challengeResponse: hash.digest('hex') }, { status: 200 })
}

export async function POST(req: NextRequest) {
  // Cancellazione dati utente eBay (best-effort). eBay richiede solo un ACK 200.
  try {
    const body = await req.json().catch(() => ({}))
    const userId = body?.notification?.data?.userId || body?.notification?.data?.username || null
    if (userId) {
      try {
        const { createAdminSupabase } = await import('@/lib/supabase-admin')
        const admin = createAdminSupabase()
        // Cancella eventuali ordini e-commerce sincronizzati collegati a quell'utente eBay.
        await admin.from('ordini_ecommerce').delete()
          .eq('piattaforma', 'ebay').eq('buyer_id', String(userId))
      } catch { /* best-effort, non bloccare l'ACK */ }
    }
    console.log('eBay account deletion notification ricevuta', JSON.stringify(body).slice(0, 400))
  } catch { /* ignora: rispondiamo comunque 200 */ }
  return new NextResponse(null, { status: 200 })
}
