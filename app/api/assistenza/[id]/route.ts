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

  // Caricamento PDF della POD (base64) -> storage -> pod_url
  if (typeof body?.podBase64 === 'string' && body.podBase64) {
    try {
      const b64 = body.podBase64.split(',').pop() || body.podBase64
      const buffer = Buffer.from(b64, 'base64')
      const path = `pod/${masterId}/${Date.now()}_${id}.pdf`
      const { error: upErr } = await admin.storage.from('reports').upload(path, buffer, { contentType: 'application/pdf', upsert: true })
      if (!upErr) {
        const { data: pub } = admin.storage.from('reports').getPublicUrl(path)
        if (pub?.publicUrl) upd.pod_url = pub.publicUrl
      }
    } catch { /* ignora: la POD resta non caricata */ }
  }

  const { error } = await admin.from('tickets').update(upd).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
