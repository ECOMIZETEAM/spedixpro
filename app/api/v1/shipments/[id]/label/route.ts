import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey } from '@/lib/api-auth'
import { leggiEtichetta } from '@/lib/etichette'

// Scarica l'etichetta (LDV) PDF della spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    .select('id,numero,etichetta_url,etichetta_path,raw_response,cliente_id').eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // leggiEtichetta sa dove vive il PDF: il file su Storage per le spedizioni nuove, il base64 nella
  // riga per quelle storiche. Qui si leggeva SOLO etichetta_url: appena una spedizione avra' il PDF
  // su Storage, questa rotta risponderebbe "Etichetta non disponibile" a chi si integra via API.
  const et = await leggiEtichetta(admin, s as any)
  if (!et) return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })
  return new NextResponse(et.buffer as any, {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="ldv_${s.numero || s.id}.${et.ext}"`,
    },
  })
}
