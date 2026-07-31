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
  //
  // ATTENZIONE, DUE COSE ERANO SBAGLIATE QUI.
  // 1) Nessuna verifica del mittente: un `curl` con un buyer_id inventato faceva cancellare righe
  //    dal database. Ora, prima di toccare qualcosa, si pretende l'intestazione di firma che eBay
  //    mette su ogni notifica vera. Senza, si risponde comunque 200 (eBay vuole l'ACK, e un 4xx
  //    ripetuto fa disattivare il keyset Production) ma non si cancella nulla.
  //    La verifica CRITTOGRAFICA della firma (chiave pubblica eBay per `kid`) resta da fare: e' il
  //    passo successivo, va provato su una notifica reale prima di renderlo bloccante.
  // 2) Il corpo finiva nei log: dentro c'e' l'identificativo dell'utente eBay, cioe' proprio il
  //    dato personale che questa chiamata ci chiede di cancellare. Se ne teneva una copia nei log
  //    invece di eliminarlo. Ora non si scrive piu' il corpo, solo l'esito.
  const firmato = !!req.headers.get('x-ebay-signature')
  try {
    const body = await req.json().catch(() => ({}))
    const userId = body?.notification?.data?.userId || body?.notification?.data?.username || null
    if (userId && firmato) {
      try {
        const { createAdminSupabase } = await import('@/lib/supabase-admin')
        const admin = createAdminSupabase()
        // 3) LA CANCELLAZIONE NON AVVENIVA. Si filtrava su una colonna `buyer_id` che in
        //    `ordini_ecommerce` non esiste e non e' mai esistita: la chiamata falliva, l'errore
        //    veniva inghiottito dal catch e si rispondeva 200. Ogni richiesta di cancellazione
        //    ricevuta da eBay non ha quindi mai tolto nulla — un impegno preso e non mantenuto.
        //    L'acquirente sta in `raw->buyer->>username`.
        // Si ANONIMIZZA invece di cancellare la riga: l'ordine e' anche un documento contabile e
        // resta collegato a una spedizione. Spariscono i dati personali (nominativo, indirizzo di
        // consegna e di registrazione), restano importi e SKU. E' la stessa scelta gia' fatta per
        // gli ordini Amazon in /api/privacy/purge-pii.
        const { data: righe } = await admin.from('ordini_ecommerce')
          .select('id,raw').eq('piattaforma', 'ebay')
          .filter('raw->buyer->>username', 'eq', String(userId)).limit(1000)
        let anonimizzati = 0
        for (const r of (righe || [])) {
          const raw: any = { ...(r as any).raw }
          delete raw.buyer
          delete raw.fulfillmentStartInstructions
          delete raw.buyerCheckoutNotes
          const { error } = await admin.from('ordini_ecommerce')
            .update({ cliente_nome: '[dati rimossi]', destinatario: null, raw })
            .eq('id', (r as any).id)
          if (!error) anonimizzati++
        }
        console.log('[EBAY][DELETION] notifica firmata: ordini anonimizzati =', anonimizzati, 'su', (righe || []).length)
      } catch (e: any) {
        // Non si nasconde piu' l'errore: se la cancellazione non riesce va saputo.
        console.error('[EBAY][DELETION] anonimizzazione fallita:', e?.message)
      }
    } else if (!firmato) {
      console.warn('[EBAY][DELETION] notifica SENZA firma: ignorata (nessuna cancellazione)')
    }
  } catch { /* ignora: rispondiamo comunque 200 */ }
  return new NextResponse(null, { status: 200 })
}
