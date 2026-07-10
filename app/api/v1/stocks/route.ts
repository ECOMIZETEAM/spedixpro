import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

// API pubblica MoovExpress — elenco delle giacenze aperte del contratto della API key.
// Auth: Authorization: Bearer <api_key>
// Query opzionale: ?stato=<giacenza_stato>
export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })

  const admin = createAdminSupabase()
  const stato = req.nextUrl.searchParams.get('stato')

  let q = admin.from('spedizioni')
    .select('id,tracking_number,numero,stato,giacenza_stato,giacenza_data,created_at,dest_nome,dest_citta,dest_provincia')
    .eq('cliente_id', ctx.clienteId)
    .eq('corriere_id', ctx.corriereId)
    .eq('stato', 'in_giacenza')
    .order('created_at', { ascending: false })
  if (stato) q = q.eq('giacenza_stato', stato)

  const { data } = await q
  const stocks = (data || []).map((s: any) => ({
    id: s.id,
    tracking: s.tracking_number || s.numero,
    stato: s.stato,
    giacenza_stato: s.giacenza_stato || 'aperta',
    destinatario: { nome: s.dest_nome, citta: s.dest_citta, provincia: s.dest_provincia },
    data_giacenza: s.giacenza_data || s.created_at,
    created_at: s.created_at,
  }))
  return NextResponse.json({ stocks })
}
