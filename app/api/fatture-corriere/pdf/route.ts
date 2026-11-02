import { NextRequest, NextResponse } from 'next/server'
import { utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { leggiPdfFatturaBrt } from '@/lib/fattura-brt-pdf'
import { confrontaLegenda } from '@/lib/fattura-brt'

// IL PDF DELLA FATTURA BRT, accanto al TIVAF: se ne legge la legenda delle sigle, il numero e i totali
// (lib/fattura-brt-pdf). Non si salva il file: torna al browser quello che serve, e la legenda va nello
// storico con la fattura. Solo per il detentore, come il controllo.
export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const corpo = await req.json().catch(() => ({})) as { pdfBase64?: string }
  const raw = String(corpo.pdfBase64 || '')
  const dati = raw.includes(',') ? raw.split(',').pop()! : raw
  if (!dati) return NextResponse.json({ error: 'Nessun PDF ricevuto.' }, { status: 400 })
  const bytes = Buffer.from(dati, 'base64')
  if (bytes.length > 15 * 1024 * 1024) return NextResponse.json({ error: 'PDF troppo grande.' }, { status: 400 })
  try {
    const lettura = await leggiPdfFatturaBrt(new Uint8Array(bytes))
    const { nuove, cambiate } = confrontaLegenda(lettura.legenda)
    // Una sigla nuova o cambiata va aggiunta a SIGLE_BRT: resta scritta nei log, così la si vede.
    if (nuove.length || cambiate.length) console.warn('[fattura-brt] legenda del PDF diversa da SIGLE_BRT', JSON.stringify({ master: u.masterId, fattura: lettura.numeroFattura, nuove, cambiate }))
    return NextResponse.json({ ...lettura, nuove, cambiate })
  } catch (e: any) {
    return NextResponse.json({ error: 'Non riesco a leggere il PDF: ' + String(e?.message || e) }, { status: 400 })
  }
}
