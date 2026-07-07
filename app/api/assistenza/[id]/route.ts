import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Aggiorna un ticket: solo il master proprietario (owner) puo' cambiare stato / rispondere.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const masterId = utente?.master_id
  if (!masterId || (utente?.ruolo || '').toLowerCase() === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  const admin = createAdminSupabase()

  const { data: t } = await admin.from('tickets').select('owner_master_id').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  if (t.owner_master_id !== masterId) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // Ogni modifica del master è un aggiornamento non ancora letto da chi ha aperto -> notifica
  const upd: any = { updated_at: new Date().toISOString(), aperto_letto: false }
  if (body?.stato && ['aperto', 'in_lavorazione', 'risolto'].includes(body.stato)) upd.stato = body.stato
  if (typeof body?.risposta === 'string') upd.risposta = body.risposta

  const { error } = await admin.from('tickets').update(upd).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
