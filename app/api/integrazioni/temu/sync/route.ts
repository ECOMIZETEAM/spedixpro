import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sincronizzaOrdiniTemu } from '@/lib/temuSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono sincronizzare' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const integrazioneId = body.integrazione_id || body.id
  if (!integrazioneId) return NextResponse.json({ error: 'integrazione_id mancante' }, { status: 400 })

  // Il token del negozio lo legge il SERVICE_ROLE, non la sessione dell'utente: `credenziali` non
  // e' leggibile da `authenticated` (e' la chiave che il negoziante ci ha dato, non un suo dato).
  // Il perimetro non cambia: i filtri sotto sono gli stessi di prima, cliente loggato compreso.
  const { data: integr } = await createAdminSupabase()
    .from('integrazioni').select('*')
    .eq('id', integrazioneId).eq('cliente_id', utente.cliente_id).eq('piattaforma', 'temu')
    .maybeSingle()
  if (!integr) return NextResponse.json({ error: 'Integrazione non trovata' }, { status: 404 })

  try {
    const res = await sincronizzaOrdiniTemu(supabase, integr)
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    await supabase.from('integrazioni').update({ stato: 'errore', errore: String(e?.message || e).slice(0, 200) }).eq('id', integr.id)
    return NextResponse.json({ error: e?.message || 'Errore sincronizzazione' }, { status: 502 })
  }
}
