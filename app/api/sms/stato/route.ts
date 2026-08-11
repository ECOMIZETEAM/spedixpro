import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COSTO_SMS_EUR } from '@/lib/sms'

export const dynamic = 'force-dynamic'

// Stato credito SMS del master + storico + clienti (per il trasferimento). Solo staff del master.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const admin = createAdminSupabase()
  const [{ data: m }, { data: mov }, { data: clienti }] = await Promise.all([
    admin.from('masters').select('credito,credito_sms').eq('id', u.master_id).maybeSingle(),
    admin.from('movimenti_sms').select('tipo,descrizione,importo,quantita_sms,saldo_dopo,cliente_id,created_at')
      .eq('master_id', u.master_id).order('created_at', { ascending: false }).limit(80),
    admin.from('clienti').select('id,ragione_sociale,credito_sms').eq('master_id', u.master_id).order('ragione_sociale'),
  ])
  return NextResponse.json({
    creditoWallet: Number(m?.credito || 0),
    creditoSms: Number(m?.credito_sms || 0),
    costoSms: COSTO_SMS_EUR,
    movimenti: mov || [],
    clienti: clienti || [],
  })
}
