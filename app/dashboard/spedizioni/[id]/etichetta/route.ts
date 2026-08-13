import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Etichetta aperta dal DETTAGLIO spedizione. Usa leggiEtichettaCompleta come tutti gli altri punti:
// così su una spedizione MULTICOLLO escono TUTTI i colli (una pagina ciascuno) e non solo il primo.
// (Prima leggeva l'etichetta singola: da qui usciva un collo solo, es. 3UW1WLJ012948 a 3 colli.)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autenticato', { status: 401 })
  // Lettura sotto RLS: se l'utente non può vedere la spedizione, torna null → 404 (auth per tenant).
  const { data: sped } = await supabase.from('spedizioni')
    .select('raw_response,tracking_number,numero,etichetta_url,etichetta_path,colli_dettaglio')
    .eq('id', id).single()
  if (!sped) return new NextResponse('Non trovata', { status: 404 })

  const { leggiEtichettaCompleta } = await import('@/lib/etichette')
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const et = await leggiEtichettaCompleta(createAdminSupabase(), sped as any)

  if (!et) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>⚠️ Etichetta non disponibile</h2>
        <p>LDV: ${sped.tracking_number || '—'}</p>
        <p>L'etichetta non è stata salvata. Ricreare la spedizione.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  return new NextResponse(new Uint8Array(et.buffer), {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.${et.ext}"`,
    },
  })
}
