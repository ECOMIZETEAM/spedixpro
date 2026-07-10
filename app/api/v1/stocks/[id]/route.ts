import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

// API pubblica MoovExpress — richiede un'azione su una giacenza aperta.
// Auth: Authorization: Bearer <api_key>
// Body: { action: 'riconsegna' | 'reso' | 'mantieni', notes? }
// La richiesta viene registrata e confermata dall'operatore dal portale.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  if (!['riconsegna', 'reso', 'mantieni'].includes(action)) {
    return NextResponse.json({ error: "action non valida (riconsegna | reso | mantieni)" }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,stato,giacenza_stato').eq('id', id).maybeSingle()
  if (!sped || sped.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Giacenza non trovata' }, { status: 404 })
  if (sped.stato !== 'in_giacenza') return NextResponse.json({ error: 'La spedizione non è in giacenza' }, { status: 409 })

  // "mantieni" = nessuna richiesta di svincolo: resta in giacenza.
  if (action === 'mantieni') {
    return NextResponse.json({ id, stato: sped.giacenza_stato || 'aperta' })
  }

  // riconsegna / reso -> registra la richiesta (l'operatore conferma dal portale)
  const { error } = await admin.from('giacenza_richieste').insert({
    spedizione_id: id, master_id: sped.master_id, cliente_id: sped.cliente_id,
    operazione: action, note: body.notes || null,
    costo_apertura: 0, costo_servizio: 0, costo_totale: 0,
    richiesta_da: 'cliente', creata_da: 'API', stato: 'da_confermare',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await admin.from('spedizioni').update({ giacenza_stato: 'in_gestione' }).eq('id', id)

  return NextResponse.json({ id, stato: 'in_gestione', azione: action })
}
