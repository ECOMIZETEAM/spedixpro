import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Gestione dei SECRET webhook (verifica firme in ingresso, es. spedisci/Poste Crono). Config di
// PIATTAFORMA, non del singolo master → riservata al SUPER MASTER. Così i secret si aggiungono dal
// pannello (Impostazioni del contratto) invece che via SQL, e NON passano in chat. In lettura il
// secret è MASCHERATO (non lo si ri-espone al browser); in scrittura si incolla nel form (HTTPS).
async function ctx() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const admin = createAdminSupabase()
  let superMaster = false
  if (u?.master_id) { const { data: m } = await admin.from('masters').select('is_super_master').eq('id', u.master_id).maybeSingle(); superMaster = !!(m as any)?.is_super_master }
  if (!superMaster) return { err: NextResponse.json({ error: 'Riservato al super master' }, { status: 403 }) }
  return { admin }
}
const maschera = (s: string) => { const t = String(s || ''); return t.length <= 8 ? '••••' : t.slice(0, 6) + '••••' + t.slice(-4) }

export async function GET(req: NextRequest) {
  const c = await ctx(); if ('err' in c) return c.err
  const provider = req.nextUrl.searchParams.get('provider') || 'spedisci'
  const { data } = await c.admin.from('webhook_secrets').select('id,label,secret,created_at').eq('provider', provider).order('created_at', { ascending: true })
  return NextResponse.json({ authorized: true, secrets: (data || []).map((r: any) => ({ id: r.id, label: r.label, secret_masked: maschera(r.secret), created_at: r.created_at })) })
}

export async function POST(req: NextRequest) {
  const c = await ctx(); if ('err' in c) return c.err
  const b = await req.json().catch(() => ({}))
  const provider = String(b?.provider || 'spedisci').trim()
  const label = String(b?.label || '').trim() || null
  const secret = String(b?.secret || '').trim()
  if (!secret) return NextResponse.json({ error: 'Secret mancante' }, { status: 400 })
  const { data: gia } = await c.admin.from('webhook_secrets').select('id').eq('provider', provider).eq('secret', secret).maybeSingle()
  if (gia) return NextResponse.json({ success: true, giaPresente: true })
  const { error } = await c.admin.from('webhook_secrets').insert({ provider, label, secret })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const c = await ctx(); if ('err' in c) return c.err
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { error } = await c.admin.from('webhook_secrets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
