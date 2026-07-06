import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey } from '@/lib/api-auth'

// Scarica l'etichetta (LDV) PDF della spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    .select('id,numero,etichetta_url,cliente_id').eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  const url = s.etichetta_url || ''
  const m = /^data:([^;]+);base64,(.*)$/.exec(url)
  if (!m) return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })
  const buf = Buffer.from(m[2], 'base64')
  return new NextResponse(buf as any, {
    headers: {
      'Content-Type': m[1] || 'application/pdf',
      'Content-Disposition': `attachment; filename="ldv_${s.numero || s.id}.pdf"`,
    },
  })
}
