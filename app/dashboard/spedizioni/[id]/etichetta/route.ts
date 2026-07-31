import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(_req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autenticato', { status: 401 })
  const { data: sped } = await supabase.from('spedizioni').select('raw_response,tracking_number,numero,etichetta_url,etichetta_path').eq('id', id).single()
  if (!sped) return new NextResponse('Non trovata', { status: 404 })
  const raw = sped.raw_response as any

  // Caso spedisci.online: labelData base64 dentro raw_response (logica originale, intatta)
  const labelData = raw?.labelData

  // Caso SpediamoPro (o altri): etichetta già salvata come data URI in etichetta_url
  let pdfBuffer: Buffer | null = null
  let mimeType = 'application/pdf'
  // Forma nuova: PDF su Storage, nella riga solo il percorso.
  if ((sped as any).etichetta_path) {
    const { leggiEtichetta } = await import('@/lib/etichette')
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const et = await leggiEtichetta(createAdminSupabase(), sped as any)
    if (et) return new NextResponse(new Uint8Array(et.buffer), { status: 200, headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.${et.ext}"`,
    } })
  }

  // etichetta_url e' la fonte primaria; labelData dentro raw_response e' la copia storica
  // (identica) e resta solo come rete di sicurezza per le spedizioni piu' vecchie.
  if (labelData && !sped.etichetta_url) {
    pdfBuffer = Buffer.from(labelData, 'base64')
  } else if (sped.etichetta_url) {
    const m = sped.etichetta_url.match(/^data:(application\/pdf|image\/[\w.+-]+);base64,(.+)$/s)
    if (m) {
      mimeType = m[1]
      pdfBuffer = Buffer.from(m[2], 'base64')
    }
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

  const ext = mimeType === 'application/pdf' ? 'pdf' : (mimeType.split('/')[1] || 'bin')
  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="etichetta-${sped.numero}.${ext}"`,
    }
  })
}
