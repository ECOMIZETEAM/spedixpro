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

  // Denominazione / ragione sociale — delimitata dal PROSSIMO campo noto per non "over-leggere".
  let ragione = grab(/denominazione[:\s]+(.+?)(?=\s+(?:forma\s+giuridica|sigla|codice\s+fiscale|partita\s+iva|p\.?\s?iva|sede\s+legale|indirizzo|numero\s+rea|\brea\b|iscri|capitale|dati\s+anagrafici|stato\b|costituzion|attivit)\b|$)/i, oneLine)
  if (!ragione) ragione = grab(/denominazione[:\s]+([^\n]{2,90})/i, testo)
  ragione = ragione.replace(/\s{2,}.*$/, '').replace(/[·•:;,\s]+$/, '').trim()
  if (ragione.length > 90) ragione = ragione.slice(0, 90).replace(/\s+\S*$/, '').trim()

  // PEC / domicilio digitale
  let pec = grab(/(?:pec|domicilio digitale)[^a-z0-9]{0,15}([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i)
  if (!pec) { const em = oneLine.match(/[a-z0-9._%+\-]+@(?:[a-z0-9.\-]*pec|legalmail|pec)[a-z0-9.\-]*\.[a-z]{2,}/i); pec = em ? em[0] : '' }

  // Sede legale: es. "COMUNE (PR) VIA ROMA, 10 CAP 20100"
  let citta = '', prov = '', indirizzo = '', cap = ''
  const sede = oneLine.match(/sede legale[^A-Za-zÀ-ù]*(?:indirizzo\s+)?([A-Za-zÀ-ù'’.\- ]+?)\s*\(([A-Z]{2})\)\s*(?:indirizzo\s+)?(.+?)\s*(?:cap\s*)?(\d{5})/i)
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
    // pdfjs-dist (build legacy): solo estrazione testo, nessun rendering -> nessun canvas
    const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
    const pdfjs = mod.getDocument ? mod : (mod.default || mod)
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    }).promise
    const parti: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      parti.push((tc.items || []).map((it: any) => (it.str || '')).join(' '))
    }
    testo = parti.join('\n')
  } catch (e: any) {
    return NextResponse.json({ error: 'Impossibile leggere il PDF: ' + (e?.message || 'errore') }, { status: 400 })
  }
  if (!testo.trim()) {
    return NextResponse.json({ error: 'Il PDF non contiene testo leggibile (potrebbe essere una scansione/immagine). Inserisci i dati manualmente.' }, { status: 400 })
  }

  // 2) Se è configurata una chiave AI la uso per maggiore precisione; altrimenti regole locali (gratis).
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic()
      const prompt = `Estrai i dati anagrafici da questa VISURA CAMERALE italiana e rispondi ESCLUSIVAMENTE con un oggetto JSON valido (nessun testo prima o dopo).
Chiavi richieste (usa "" se il dato manca):
{"ragione_sociale":"","piva":"","cf":"","pec":"","cod_sdi":"","rappresentante_legale":"","telefono":"","indirizzo":"","citta":"","provincia":"","cap":""}
Regole:
- "ragione_sociale": SOLO la denominazione dell'azienda con la forma giuridica (es. "MARIO ROSSI S.R.L."), niente altro testo.
- Usa la SEDE LEGALE per "indirizzo", "citta", "provincia" (sigla di 2 lettere) e "cap".
- "indirizzo": solo via/piazza e numero civico (es. "VIA ROMA 10"), senza città né CAP.
- "piva": 11 cifre (senza "IT"). "cf": 11 cifre oppure 16 caratteri.
- "pec": l'indirizzo PEC / domicilio digitale.
- "rappresentante_legale": nome e cognome dell'amministratore / legale rappresentante.

VISURA:
${testo.slice(0, 30000)}`
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      })
      const txt = (msg.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('')
      const m = txt.match(/\{[\s\S]*\}/)
      if (m) {
        const dati = JSON.parse(m[0])
        return NextResponse.json({ success: true, dati, fonte: 'ai' })
      }
    } catch {
      // se l'AI fallisce, ricado sulle regole locali
    }
  }

  const dati = estraiCampi(testo)
  return NextResponse.json({ success: true, dati, fonte: 'locale' })
}
