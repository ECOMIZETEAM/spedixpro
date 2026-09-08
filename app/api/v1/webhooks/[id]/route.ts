import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { generaSecretWebhook, EVENTI_WEBHOOK } from '@/lib/webhooks'

// DELETE/PATCH /api/v1/webhooks/[id] — gestione di un singolo webhook.
// Sempre vincolato al cliente della chiave API: non si tocca il webhook di un altro account.

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const admin = createAdminSupabase()
  const { data, error } = await admin.from('webhooks').delete()
    .eq('id', id).eq('cliente_id', ctx.clienteId).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Webhook non trovato' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// PATCH: { attivo?: boolean, eventi?: string[], rotateSecret?: true }.
// rotateSecret restituisce un NUOVO secret (l'unico modo per riottenerne uno dopo la creazione).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()

  // Deve appartenere all'account della chiave.
  const { data: hook } = await admin.from('webhooks').select('id').eq('id', id).eq('cliente_id', ctx.clienteId).maybeSingle()
  if (!hook) return NextResponse.json({ error: 'Webhook non trovato' }, { status: 404 })

  const upd: any = {}
  if (typeof body?.attivo === 'boolean') upd.attivo = body.attivo
  if (Array.isArray(body?.eventi)) {
    const ev = body.eventi.filter((e: any) => EVENTI_WEBHOOK.includes(e))
    upd.eventi = ev.length ? ev : null
  }
  let nuovoSecret: string | null = null
  if (body?.rotateSecret === true) { nuovoSecret = generaSecretWebhook(); upd.secret = nuovoSecret }
  if (!Object.keys(upd).length) return NextResponse.json({ error: 'Niente da aggiornare (attivo, eventi o rotateSecret)' }, { status: 400 })

  const { error } = await admin.from('webhooks').update(upd).eq('id', id).eq('cliente_id', ctx.clienteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, ...(nuovoSecret ? { secret: nuovoSecret } : {}) })
}
