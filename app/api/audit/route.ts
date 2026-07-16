import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Registro attività (audit log) — SOLO super master (Davide/MoovExpress).
// Legge public.audit_log (popolato dai trigger DB sui listini): chi ha cambiato cosa, da->a.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  // Gate super master: solo chi ha is_super_master può vedere il registro.
  const { data: m } = await admin.from('masters').select('is_super_master').eq('id', utente.master_id).single()
  if (!m?.is_super_master) return NextResponse.json({ error: 'Sezione riservata al super master' }, { status: 403 })

  const p = req.nextUrl.searchParams
  const tabella = p.get('tabella')
  const q = (p.get('q') || '').trim()
  const dal = p.get('dal')
  const al = p.get('al')
  const limit = Math.min(500, Math.max(1, parseInt(p.get('limit') || '200') || 200))

  let query = admin.from('audit_log').select('*').order('at', { ascending: false }).limit(q ? 2000 : limit)
  if (tabella) query = query.eq('tabella', tabella)
  if (dal) query = query.gte('at', dal)
  if (al) query = query.lte('at', al + 'T23:59:59')
  const { data } = await query
  let righe = data || []
  // ricerca testo su attore, record_id e contenuto delle modifiche (jsonb)
  if (q) {
    const ql = q.toLowerCase()
    righe = righe.filter((r: any) =>
      (r.attore || '').toLowerCase().includes(ql) ||
      (r.record_id || '').toLowerCase().includes(ql) ||
      JSON.stringify(r.modifiche || {}).toLowerCase().includes(ql))
    righe = righe.slice(0, limit)
  }
  return NextResponse.json({ righe })
}
