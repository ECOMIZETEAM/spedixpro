import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pagaSoloEtichette } from '@/lib/conti-shopify'

export const dynamic = 'force-dynamic'

// Configura l'AUTO-RICARICA SMS del titolare (cliente o master): quando gli SMS scendono sotto la
// soglia, si riaddebita in automatico un pacchetto sulla carta salvata. Sta in impostazioni.sms_auto.
const PACCHETTI = [1000, 5000, 10000]

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).maybeSingle()
  const ruolo = (u?.ruolo || '').toLowerCase()

  const body = await req.json().catch(() => ({} as any))
  const attiva = body?.attiva === true
  const soglia = Math.max(0, Math.floor(Number(body?.soglia)) || 0)
  const pacchetto = Math.floor(Number(body?.pacchetto))
  if (attiva && !PACCHETTI.includes(pacchetto)) {
    return NextResponse.json({ error: 'Pacchetto non valido' }, { status: 400 })
  }
  const sms_auto = { attiva, soglia, pacchetto: PACCHETTI.includes(pacchetto) ? pacchetto : 1000 }

  const admin = createAdminSupabase()
  const tabella = u?.cliente_id ? 'clienti' : (u?.master_id && ['master', 'admin', 'operatore'].includes(ruolo)) ? 'masters' : null
  const id = u?.cliente_id || u?.master_id
  if (!tabella || !id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // Ai negozi sotto il master dell'App Store l'auto-ricarica non si accende: e' un acquisto di SMS con la
  // carta, che per loro e' chiuso (lib/conti-shopify.ts; stesso testo di /api/sms/acquista). Spegnerla
  // resta sempre possibile. La guardia vera, per ogni porta, e' in autoRicaricaSeServe (lib/sms.ts).
  if (attiva && tabella === 'clienti') {
    const { data: cli, error: eCli } = await admin.from('clienti').select('master_id').eq('id', id).maybeSingle()
    if (eCli) return NextResponse.json({ error: 'Non riesco a leggere il tuo conto in questo momento. Riprova.' }, { status: 503 })
    if (pagaSoloEtichette(cli?.master_id)) return NextResponse.json({ error: 'Acquisto SMS non disponibile per i negozi collegati da Shopify.' }, { status: 403 })
  }

  const { data: riga } = await admin.from(tabella).select('impostazioni').eq('id', id).maybeSingle()
  const imp = { ...((riga?.impostazioni as any) || {}), sms_auto }
  const { error } = await admin.from(tabella).update({ impostazioni: imp }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, auto: sms_auto })
}
