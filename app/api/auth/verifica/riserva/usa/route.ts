import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sessioneDellaRichiesta, usaCodiceRiserva } from '@/lib/verifica-metodi'

// Un codice di riserva al posto dell'app o della mail: vale una volta sola.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await sessioneDellaRichiesta(supabase)
  if (!s) return NextResponse.json({ error: 'Sessione scaduta: accedi di nuovo.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const esito = await usaCodiceRiserva(createAdminSupabase(), s.user, s.sessionId, body?.codice)
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status })
  return NextResponse.json({ ok: true, restano: esito.restano })
}
