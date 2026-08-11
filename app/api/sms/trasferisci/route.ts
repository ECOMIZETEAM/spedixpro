import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Trasferimento (frazionamento) di credito SMS dal master a un suo cliente. Solo staff del master.
// L'appartenenza cliente→master è ri-verificata anche dentro la RPC (difesa nel DB).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const clienteId = String(body?.clienteId || '')
  const importo = Number(body?.importo)
  if (!clienteId) return NextResponse.json({ error: 'Cliente mancante' }, { status: 400 })
  if (!Number.isFinite(importo) || importo <= 0) return NextResponse.json({ error: 'Importo non valido' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data, error } = await admin.rpc('sms_trasferisci', {
    p_master_id: u.master_id, p_cliente_id: clienteId, p_importo: importo, p_created_by: user.id,
  })
  if (error) {
    const msg = /insufficiente|non appartiene/i.test(error.message) ? error.message : 'Trasferimento non riuscito'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ ok: true, creditoSms: Number(data || 0) })
}
