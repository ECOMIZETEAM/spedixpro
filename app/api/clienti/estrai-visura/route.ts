import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

// Campi che estraiamo dalla visura camerale
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ragione_sociale: { type: 'string', description: 'Denominazione / ragione sociale completa dell\'azienda' },
    piva: { type: 'string', description: 'Partita IVA (solo le 11 cifre, senza prefisso IT)' },
    cf: { type: 'string', description: 'Codice fiscale dell\'azienda' },
    pec: { type: 'string', description: 'Indirizzo PEC (posta elettronica certificata), stringa vuota se assente' },
    cod_sdi: { type: 'string', description: 'Codice destinatario SDI per la fattura elettronica, stringa vuota se assente' },
    rappresentante_legale: { type: 'string', description: 'Nome e cognome del rappresentante legale / amministratore unico' },
    telefono: { type: 'string', description: 'Numero di telefono, stringa vuota se assente' },
    indirizzo: { type: 'string', description: 'Indirizzo della sede legale: via/piazza e numero civico' },
    citta: { type: 'string', description: 'Comune della sede legale' },
    provincia: { type: 'string', description: 'Sigla della provincia della sede legale (2 lettere maiuscole)' },
    cap: { type: 'string', description: 'CAP della sede legale' },
  },
  required: ['ragione_sociale', 'piva', 'cf', 'pec', 'cod_sdi', 'rappresentante_legale', 'telefono', 'indirizzo', 'citta', 'provincia', 'cap'],
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Estrazione automatica non configurata: manca la chiave ANTHROPIC_API_KEY.' }, { status: 400 })
  }

  const body = await req.json()
  const raw: string = body?.pdfBase64 || ''
  if (!raw) return NextResponse.json({ error: 'Nessun PDF ricevuto' }, { status: 400 })
  const data = raw.includes(',') ? raw.split(',').pop()! : raw

  const client = new Anthropic()
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
          { type: 'text', text: 'Questo è il PDF di una visura camerale italiana. Estrai i dati anagrafici dell\'azienda secondo lo schema richiesto. Usa la SEDE LEGALE per indirizzo/città/provincia/CAP. Se un dato non è presente restituisci una stringa vuota. Non inventare valori.' },
        ],
      }],
    } as any)
    const block = (msg.content as any[]).find((b) => b.type === 'text')
    const testo = block?.text || '{}'
    const dati = JSON.parse(testo)
    return NextResponse.json({ success: true, dati })
  } catch (e: any) {
    return NextResponse.json({ error: 'Errore durante l\'estrazione: ' + (e?.message || 'sconosciuto') }, { status: 400 })
  }
}
