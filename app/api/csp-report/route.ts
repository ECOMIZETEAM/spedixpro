import { NextRequest, NextResponse } from 'next/server'

// RACCOGLITORE delle violazioni CSP (fase Report-Only). Il browser POSTa qui ogni risorsa che la
// policy BLOCCHEREBBE — ma in Report-Only NON blocca niente: serve solo a TARARE la policy sui dati
// veri prima di attivarla. Pubblico e senza sessione (la segnalazione arriva da qualunque contesto,
// anche dalla pagina di accesso o da una sessione non ancora verificata): il middleware ha un bypass
// per questa rotta. Non scrive niente nel database: logga solo l'essenziale nei log Vercel. Si toglie
// (rotta + header + bypass) quando la policy è tarata e si passa a Content-Security-Policy attiva.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const testo = await req.text()
    const j: any = JSON.parse(testo)
    const r = j['csp-report'] || (Array.isArray(j) ? j[0]?.body : null) || j
    console.warn('[CSP][VIOLAZIONE]', JSON.stringify({
      direttiva: r['violated-directive'] || r['effective-directive'] || r.violatedDirective || r.effectiveDirective,
      bloccato: r['blocked-uri'] || r.blockedURL || r.blockedURI,
      pagina: r['document-uri'] || r.documentURL || r.documentURI,
    }).slice(0, 600))
  } catch { /* report malformato o vuoto: si ignora, non deve mai dare errore al browser */ }
  return new NextResponse(null, { status: 204 })
}
