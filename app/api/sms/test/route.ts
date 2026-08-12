import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaSms, smsConfigurato, normalizzaTelefonoIT } from '@/lib/sms'

export const dynamic = 'force-dynamic'

// SMS DI PROVA per verificare il gateway (login + mittente registrato + consegna) SENZA creare una
// spedizione vera. Manda un solo SMS al numero indicato e NON tocca il credito SMS interno: è una
// diagnostica. Il gateway Esendex/Skebby è UNICO e globale (conto E&A), quindi ogni invio spende il
// credito vero: per questo è riservato al master RADICE (senza genitore) — un sotto-master non deve
// poter far partire invii dal conto della piattaforma bypassando il proprio credito.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('parent_master_id,sms_test_abilitato').eq('id', u.master_id).maybeSingle()
  if (m?.parent_master_id && !m?.sms_test_abilitato) {
    return NextResponse.json({ error: 'Prove SMS non abilitate per questo master.' }, { status: 403 })
  }
  if (!smsConfigurato()) {
    return NextResponse.json({ error: 'Gateway non configurato: mancano le credenziali SMS su Vercel (ESENDEX_USERNAME, ESENDEX_PASSWORD).' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const tel = normalizzaTelefonoIT(body?.telefono)
  if (!tel) return NextResponse.json({ error: 'Numero non valido: serve un cellulare italiano (es. 3401234567).' }, { status: 400 })

  const esito = await inviaSms(tel, 'MoovExpress · SMS di prova. Se lo ricevi, il gateway è attivo ✅')
  if (!esito.ok) return NextResponse.json({ error: `Invio non riuscito: ${esito.error || 'errore sconosciuto'}` }, { status: 502 })
  return NextResponse.json({ ok: true, inviatoA: tel })
}
