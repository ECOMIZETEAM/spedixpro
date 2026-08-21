import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'

// ACCETTA PREVENTIVO (pubblico, per token). Il destinatario accetta → il preventivo va IN ATTESA di
// attivazione (stato='accettato_da_confermare') e il master viene notificato. Qui NON si crea più nulla:
// l'attivazione vera (posizione + credenziali + listino reale) la fa il MASTER dal suo portale con la
// RICONFERMA (POST /api/preventivi/[id] azione 'attiva' → lib/preventivo-attiva.ts). Così è il master a
// decidere quando aprire la posizione, invece che il solo possesso del token pubblico.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const token = String(b.token || '').trim()
  if (!/^[a-f0-9]{20,40}$/.test(token)) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato,valido_fino,listino_template_id,dest_nome,oggetto,created_by').eq('token', token).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  // Idempotente: già accettato (in attesa o attivato) → ok, non si ripete.
  if (p.stato === 'accettato' || p.stato === 'accettato_da_confermare') return NextResponse.json({ ok: true, gia: true })
  if (p.stato === 'rifiutato') return NextResponse.json({ error: 'Preventivo non più valido.' }, { status: 400 })
  if (p.valido_fino && new Date(p.valido_fino) < new Date(new Date().toDateString())) return NextResponse.json({ error: 'Preventivo scaduto.' }, { status: 400 })
  if (!p.listino_template_id) return NextResponse.json({ error: 'Preventivo senza prezzi.' }, { status: 400 })

  const now = new Date().toISOString()
  await admin.from('preventivi').update({ stato: 'accettato_da_confermare', accettato_il: now, updated_at: now }).eq('id', p.id)
  // Notifica al master: accettato, DA CONFERMARE (è lui che apre la posizione e manda le credenziali).
  try {
    await admin.from('notifiche').insert({
      master_id: p.master_id, cliente_id: null, gruppi: ['Amministratore', 'Operatore'],
      oggetto: 'Preventivo accettato — da confermare',
      messaggio: `${p.dest_nome || ''} ha accettato il preventivo${p.oggetto ? ' — ' + p.oggetto : ''}. Conferma dal portale per attivare la posizione.`.trim(),
      link: '/dashboard/preventivi', created_by: p.created_by,
    })
  } catch {}
  return NextResponse.json({ ok: true, inAttesa: true })
}
