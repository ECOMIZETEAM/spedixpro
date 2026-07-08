import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { sincronizzaOrdiniWoo } from '@/lib/wooSync'

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

  const { data: integr } = await supabase
    .from('integrazioni').select('*')
    .eq('id', integrazioneId).eq('cliente_id', utente.cliente_id).eq('piattaforma', 'woocommerce')
    .maybeSingle()
  if (!integr) return NextResponse.json({ error: 'Integrazione non trovata' }, { status: 404 })

  try {
    const res = await sincronizzaOrdiniWoo(supabase, integr)
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore sincronizzazione' }, { status: 502 })
  }
}
