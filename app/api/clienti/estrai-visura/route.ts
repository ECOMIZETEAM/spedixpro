import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

// ── Estrazione dei campi dal TESTO della visura camerale (nessuna API a pagamento) ──
function estraiCampi(testoRaw: string) {
  const testo = testoRaw.replace(/\r/g, '')
  const oneLine = testo.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  const grab = (re: RegExp, src: string = oneLine) => { const x = src.match(re); return x ? (x[1] || '').trim() : '' }

  // Partita IVA (11 cifre) e Codice fiscale (11 cifre o 16 alfanumerici)
  let piva = grab(/partita\s*iva[^0-9]{0,12}(\d{11})/i)
  if (!piva) piva = grab(/\bIT[\s-]?(\d{11})\b/i)
  let cf = grab(/codice\s*fiscale[^0-9A-Z]{0,12}([0-9]{11}|[A-Z0-9]{16})/i)
  if (!cf && piva) cf = piva // per le società di norma coincidono

  // Denominazione / ragione sociale
  let ragione = grab(/denominazione[:\s]+([^\n]+?)(?:\s{2,}|forma giuridica|codice fiscale|indirizzo|$)/i, testo)
  if (!ragione) ragione = grab(/denominazione[:\s]+(.+)/i)
  ragione = ragione.replace(/\s*(dati anagrafici|forma giuridica).*$/i, '').trim()

  // PEC / domicilio digitale
  let pec = grab(/(?:pec|domicilio digitale)[^a-z0-9]{0,15}([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i)
  if (!pec) { const em = oneLine.match(/[a-z0-9._%+\-]+@(?:[a-z0-9.\-]*pec|legalmail|pec)[a-z0-9.\-]*\.[a-z]{2,}/i); pec = em ? em[0] : '' }

  // Sede legale: es. "COMUNE (PR) VIA ROMA, 10 CAP 20100"
  let citta = '', prov = '', indirizzo = '', cap = ''
  const sede = oneLine.match(/sede legale[^A-Za-zÀ-ù]*([A-Za-zÀ-ù'’.\- ]+?)\s*\(([A-Z]{2})\)\s*(.+?)\s*(?:cap\s*)?(\d{5})/i)
  if (sede) {
    citta = sede[1].trim(); prov = sede[2]
    indirizzo = sede[3].replace(/\bcap\b/i, '').replace(/[,;]\s*$/, '').trim(); cap = sede[4]
  } else {
    cap = grab(/\bcap\b[:\s]*(\d{5})/i)
    prov = grab(/provincia[:\s]*([A-Z]{2})\b/i)
    citta = grab(/comune[:\s]+([A-Za-zÀ-ù'’.\- ]+?)(?:\s{2,}|provincia|cap|$)/i)
    indirizzo = grab(/(?:indirizzo|via|viale|piazza|corso|largo)[:\s]+([^\n,;]+)/i)
  }

  // Rappresentante legale / amministratore
  const rappr = grab(/(?:amministratore unico|legale rappresentante|rappresentante legale|presidente del consiglio)[^A-Za-zÀ-ù]{0,25}([A-ZÀ-Ù][A-Za-zÀ-ù'’]+(?:\s+[A-ZÀ-Ù][A-Za-zÀ-ù'’]+){1,3})/i)

  return {
    ragione_sociale: ragione, piva, cf, pec, cod_sdi: '',
    rappresentante_legale: rappr, telefono: '',
    indirizzo, citta, provincia: prov.toUpperCase(), cap,
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const raw: string = body?.pdfBase64 || ''
  if (!raw) return NextResponse.json({ error: 'Nessun PDF ricevuto' }, { status: 400 })
  const data = raw.includes(',') ? raw.split(',').pop()! : raw
  const buffer = Buffer.from(data, 'base64')

  // 1) Estrae il testo dal PDF (in locale, gratis)
  let testo = ''
  try {
    const { PDFParse } = (await import('pdf-parse')) as any
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const parsed = await parser.getText()
    testo = parsed?.text || ''
  } catch {
    return NextResponse.json({ error: 'Impossibile leggere il PDF' }, { status: 400 })
  }
  if (!testo.trim()) {
    return NextResponse.json({ error: 'Il PDF non contiene testo leggibile (potrebbe essere una scansione/immagine). Inserisci i dati manualmente.' }, { status: 400 })
  }

  // 2) Se è configurata una chiave AI la uso per maggiore precisione; altrimenti regole locali (gratis).
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const SCHEMA = {
        type: 'object', additionalProperties: false,
        properties: {
          ragione_sociale: { type: 'string' }, piva: { type: 'string' }, cf: { type: 'string' },
          pec: { type: 'string' }, cod_sdi: { type: 'string' }, rappresentante_legale: { type: 'string' },
          telefono: { type: 'string' }, indirizzo: { type: 'string' }, citta: { type: 'string' },
          provincia: { type: 'string' }, cap: { type: 'string' },
        },
        required: ['ragione_sociale', 'piva', 'cf', 'pec', 'cod_sdi', 'rappresentante_legale', 'telefono', 'indirizzo', 'citta', 'provincia', 'cap'],
      }
      const client = new Anthropic()
      const msg = await client.messages.create({
        model: 'claude-opus-4-8', max_tokens: 1024,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: 'Estrai i dati anagrafici da questa visura camerale (usa la SEDE LEGALE per indirizzo/citta/provincia/cap; stringa vuota se un dato manca):\n\n' + testo.slice(0, 30000) }],
      } as any)
      const block = (msg.content as any[]).find((b) => b.type === 'text')
      const dati = JSON.parse(block?.text || '{}')
      return NextResponse.json({ success: true, dati, fonte: 'ai' })
    } catch {
      // se l'AI fallisce, ricado sulle regole locali
    }
  }

  const dati = estraiCampi(testo)
  return NextResponse.json({ success: true, dati, fonte: 'locale' })
}
