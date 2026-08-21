import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'

// RIFIUTA PREVENTIVO (pubblico, per token): il destinatario dice no. Mette stato='rifiutato' e avvisa
// il master. Speculare all'accettazione; non crea/tocca nulla d'altro. Idempotente.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const token = String(b.token || '').trim()
  if (!/^[a-f0-9]{20,40}$/.test(token)) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato,dest_nome,oggetto,created_by').eq('token', token).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  if (p.stato === 'accettato' || p.stato === 'accettato_da_confermare') return NextResponse.json({ error: 'Preventivo già accettato.' }, { status: 400 })
  if (p.stato === 'rifiutato') return NextResponse.json({ ok: true, gia: true })
  await admin.from('preventivi').update({ stato: 'rifiutato', rifiutato_il: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', p.id)
  try {
    await admin.from('notifiche').insert({
      master_id: p.master_id, cliente_id: null, gruppi: ['Amministratore', 'Operatore'],
      oggetto: 'Preventivo rifiutato', messaggio: `${p.dest_nome || ''} ha rifiutato il preventivo${p.oggetto ? ' — ' + p.oggetto : ''}`.trim(),
      link: '/dashboard/preventivi', created_by: p.created_by,
    })
  } catch {}
  return NextResponse.json({ ok: true })
}
