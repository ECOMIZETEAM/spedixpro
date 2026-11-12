import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { firmaInoltroKsync, HOST_KSYNC_AMMESSI, SERVIZI_KSYNC_AMMESSI } from '@/lib/ksync'

// INOLTRO VERSO KSYNC DA FRANCOFORTE.
//
// Il server di KSync rifiuta le connessioni da fuori UE e le nostre funzioni girano a Londra (lhr1): il
// 12/11/2026 ogni creazione SDA EXPRESS L diretta falliva con ECONNREFUSED. Questa e' l'unica funzione
// che vercel.json fa girare in fra1: riceve da lib/ksync.ts (chiamaKsyncWs) la chiamata SOAP gia' pronta
// e la gira a KSync, tale e quale. Non legge ne' scrive il database.
//
// Chi puo' chiamarla: solo il nostro codice. La richiesta e' firmata (HMAC) con la chiave di servizio,
// che ha soltanto il server; vale 5 minuti. E inoltra solo agli indirizzi e ai servizi KSync ammessi in
// lib/ksync.ts: non e' un passaggio aperto verso qualunque indirizzo.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const corpo = await req.text()
  const firma = req.headers.get('x-firma') || ''
  const attesa = firmaInoltroKsync(corpo)
  const valida = !!process.env.SUPABASE_SERVICE_ROLE_KEY && firma.length === attesa.length && timingSafeEqual(Buffer.from(firma), Buffer.from(attesa))
  if (!valida) return NextResponse.json({ errore: 'Non autorizzato' }, { status: 401 })

  let dati: { host?: string; servizio?: string; soap?: string; t?: number }
  try { dati = JSON.parse(corpo) } catch { return NextResponse.json({ errore: 'Richiesta non valida' }, { status: 400 }) }
  if (!dati.t || Math.abs(Date.now() - Number(dati.t)) > 5 * 60_000) return NextResponse.json({ errore: 'Richiesta scaduta' }, { status: 401 })
  let host: URL
  try { host = new URL(String(dati.host || '')) } catch { return NextResponse.json({ errore: 'Indirizzo non valido' }, { status: 400 }) }
  if (host.protocol !== 'https:' || !HOST_KSYNC_AMMESSI.has(host.hostname) || !SERVIZI_KSYNC_AMMESSI.has(String(dati.servizio || ''))) {
    return NextResponse.json({ errore: 'Servizio non ammesso' }, { status: 400 })
  }

  try {
    const r = await fetch(`${String(dati.host).replace(/\/+$/, '')}/${dati.servizio}`, {
      method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' }, body: String(dati.soap || ''),
    })
    return NextResponse.json({ status: r.status, testo: await r.text() })
  } catch (e: any) {
    // La regione nel messaggio dice subito se l'inoltro non sta girando dove deve (vercel.json).
    console.error('[KSYNC-INOLTRO]', process.env.VERCEL_REGION, e?.message, e?.cause?.code)
    return NextResponse.json({ errore: `KSync non raggiungibile da ${process.env.VERCEL_REGION || '?'}: ${e?.message || 'rete'}${e?.cause?.code ? ` (${e.cause.code})` : ''}` }, { status: 502 })
  }
}
