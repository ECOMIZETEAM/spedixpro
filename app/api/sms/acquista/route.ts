import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COSTO_SMS_EUR } from '@/lib/sms'

export const dynamic = 'force-dynamic'

// Acquisto credito SMS: scala l'importo dal wallet principale del master (via RPC atomica, che scrive
// anche su `movimenti`) e accredita il bucket credito_sms. Solo staff del master, solo per sé.
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
  const quantita = Math.floor(Number(body?.quantita))
  if (!Number.isFinite(quantita) || quantita <= 0) {
    return NextResponse.json({ error: 'Quantità SMS non valida' }, { status: 400 })
  }
  const admin = createAdminSupabase()
  const { data, error } = await admin.rpc('sms_acquista', {
    p_master_id: u.master_id, p_quantita: quantita, p_costo_unitario: COSTO_SMS_EUR, p_created_by: user.id,
  })
  if (error) {
    // Messaggio pulito su credito insufficiente (P0001); il resto resta generico.
    const msg = /insufficiente/i.test(error.message) ? error.message : 'Impossibile completare l\'acquisto'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ ok: true, creditoSms: Number(data || 0) })
}
