import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COSTO_SMS_EUR } from '@/lib/sms'

export const dynamic = 'force-dynamic'

// ACCREDITO DI PROVA (gratis) per collaudare il flusso SMS senza pagare: aggiunge un piccolo numero
// di SMS al credito del master RADICE (il gestore della piattaforma). Riservato al master radice —
// il gateway e il credito sono di E&A, quindi solo lui può regalarsi SMS di prova. Ogni chiamata
// accredita una volta (riferimento unico), così si può cliccare più volte in fase di test.
const SMS_PROVA = 25

export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('parent_master_id,sms_test_abilitato').eq('id', u.master_id).maybeSingle()
  if (m?.parent_master_id && !m?.sms_test_abilitato) return NextResponse.json({ error: 'Prove SMS non abilitate per questo master.' }, { status: 403 })

  const { data, error } = await admin.rpc('sms_accredita_carta', {
    p_master_id: u.master_id, p_cliente_id: null, p_quantita: SMS_PROVA,
    p_costo_unitario: COSTO_SMS_EUR, p_riferimento: 'test:' + randomUUID(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, aggiunti: SMS_PROVA, creditoSms: Number(data || 0) })
}
