import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { leggiEtichettaCompleta } from '@/lib/etichette'

// Scarica l'etichetta (LDV) PDF della spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    .select('id,numero,etichetta_url,etichetta_path,colli_dettaglio,raw_response,cliente_id,corriere_id,rif_ordine,contenuto').eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // leggiEtichettaCompleta sa dove vive il PDF (Storage o base64) ED è MULTICOLLO: su una spedizione
  // a più colli unisce tutte le etichette in un unico PDF, così chi si integra via API non riceve il
  // solo primo collo. Prima usava leggiEtichetta (singola) e non leggeva nemmeno colli_dettaglio.
  const et = await leggiEtichettaCompleta(admin, s as any)
  if (!et) return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })
  return new NextResponse(et.buffer as any, {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="ldv_${s.numero || s.id}.${et.ext}"`,
    },
  })
}
