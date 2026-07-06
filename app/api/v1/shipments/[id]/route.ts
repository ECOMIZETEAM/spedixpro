import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey } from '@/lib/api-auth'

// Dettaglio/stato di una spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,stato,costo_totale,dest_nome,dest_citta,dest_provincia,dest_cap,dest_paese,peso_reale,colli,contrassegno,created_at,cliente_id,corriere_id,corrieri(nome_contratto)')
    .eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  return NextResponse.json({
    id: s.id, tracking: s.tracking_number || s.numero, stato: s.stato,
    contratto: (s.corrieri as any)?.nome_contratto || null, prezzo: Number(s.costo_totale || 0), valuta: 'EUR',
    destinatario: { nome: s.dest_nome, citta: s.dest_citta, provincia: s.dest_provincia, cap: s.dest_cap, paese: s.dest_paese },
    colli: s.colli, peso: s.peso_reale, contrassegno: Number(s.contrassegno || 0),
    label_url: `/api/v1/shipments/${s.id}/label`, created_at: s.created_at,
  })
}
