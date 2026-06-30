import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autenticato', { status: 401 })

  const { data: sped } = await supabase.from('spedizioni').select('raw_response,tracking_number,numero').eq('id', id).single()
  if (!sped) return new NextResponse('Non trovata', { status: 404 })

  const raw = sped.raw_response as any
  const labelData = raw?.labelData

  if (!labelData) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>⚠️ Etichetta non disponibile</h2>
        <p>LDV: ${sped.tracking_number || '—'}</p>
        <p>L'etichetta non è stata salvata. Ricreare la spedizione.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  // Converti base64 → PDF e invia direttamente
  const pdfBuffer = Buffer.from(labelData, 'base64')
  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="etichetta-${sped.numero}.pdf"`,
    }
  })
}
