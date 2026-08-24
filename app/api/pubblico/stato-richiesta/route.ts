import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pianoById } from '@/lib/piani'

// STATO PUBBLICO di una richiesta rivenditore (per la pagina vetrina /stato-richiesta/[token]).
// Legge SOLO stato + nome + piano tramite il token: nessun dato sensibile, nessun elenco.
export const dynamic = 'force-dynamic'

const ORIGINI = ['https://www.moovexpress.com', 'https://moovexpress-web.vercel.app']
const H = (o: string | null) => ({
  'Access-Control-Allow-Origin': ORIGINI.includes(o || '') ? o! : ORIGINI[0],
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
})

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: H(req.headers.get('origin')) })
}

export async function GET(req: NextRequest) {
  const headers = H(req.headers.get('origin'))
  const token = String(req.nextUrl.searchParams.get('t') || '').trim()
  if (!/^[a-f0-9]{20,64}$/.test(token)) return NextResponse.json({ errore: 'Richiesta non trovata' }, { status: 404, headers })
  const admin = createAdminSupabase()
  const { data } = await admin.from('masters')
    .select('nome,registrazione_stato,piano_richiesto')
    .eq('richiesta_token', token).maybeSingle()
  if (!data || !data.registrazione_stato) return NextResponse.json({ errore: 'Richiesta non trovata' }, { status: 404, headers })
  return NextResponse.json({
    stato: data.registrazione_stato,                 // 'da_approvare' | 'approvato' | 'rifiutato'
    nome: data.nome,
    piano: pianoById(String(data.piano_richiesto || ''))?.nome || null,
  }, { headers })
}
