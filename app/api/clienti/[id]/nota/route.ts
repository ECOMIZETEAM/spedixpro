import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

// NOTA PRIVATA del master su un cliente (o sotto-master): il cliente/agente NON la vede MAI. Vive in
// note_clienti (solo service_role, nessuna policy), chiave (soggetto, master_id AUTORE) → ogni master
// vede e scrive SOLO le proprie note. `soggetto` = l'id come in URL (uuid cliente o "m:<masterId>").
async function contesto(supabase: any): Promise<{ userId: string; masterId: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || ruolo === 'cliente' || ruolo === 'agente') return null   // solo staff del master
  return { userId: user.id, masterId: u.master_id }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const ctx = await contesto(supabase)
  if (!ctx) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data } = await admin.from('note_clienti').select('testo,updated_at')
    .eq('soggetto', id).eq('master_id', ctx.masterId).maybeSingle()
  return NextResponse.json({ testo: data?.testo || '', updated_at: data?.updated_at || null })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const ctx = await contesto(supabase)
  if (!ctx) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const b = await req.json().catch(() => ({}))
  const testo = typeof b.testo === 'string' ? b.testo.slice(0, 5000) : ''
  const admin = createAdminSupabase()
  const { error } = await admin.from('note_clienti').upsert({
    soggetto: id, master_id: ctx.masterId, testo, updated_at: new Date().toISOString(), updated_by: ctx.userId,
  }, { onConflict: 'soggetto,master_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, updated_at: new Date().toISOString() })
}
