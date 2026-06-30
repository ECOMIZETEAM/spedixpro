import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(_req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autenticato', { status: 401 })
  const { data: sped } = await supabase.from('spedizioni').select('raw_response,tracking_number,numero,etichetta_url').eq('id', id).single()
  if (!sped) return new NextResponse('Non trovata', { status: 404 })
  const raw = sped.raw_response as any

  // Caso spedisci.online: labelData base64 dentro raw_response (logica originale, intatta)
  const labelData = raw?.labelData

  // Caso SpediamoPro (o altri): etichetta già salvata come data URI in etichetta_url
  let pdfBuffer: Buffer | null = null

  if (labelData) {
    pdfBuffer = Buffer.from(labelData, 'base64')
  } else if (sped.etichetta_url && sped.etichetta_url.startsWith('data:application/pdf;base64,')) {
    const base64Part = sped.etichetta_url.split(',')[1]
    if (base64Part) pdfBuffer = Buffer.from(base64Part, 'base64')
  }

  if (!pdfBuffer) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>⚠️ Etichetta non disponibile</h2>
        <p>LDV: ${sped.tracking_number || '—'}</p>
        <p>L'etichetta non è stata salvata. Ricreare la spedizione.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="etichetta-${sped.numero}.pdf"`,
    }
  })
}
