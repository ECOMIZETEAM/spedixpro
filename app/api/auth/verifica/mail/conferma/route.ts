import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { confermaCodiceMail, sessioneDellaRichiesta, sessioneVerificata } from '@/lib/verifica-metodi'

// Il codice arrivato via mail: se e' giusto questa sessione puo' lavorare, e la mail diventa uno dei metodi.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await sessioneDellaRichiesta(supabase)
  if (!s) return NextResponse.json({ error: 'Sessione scaduta: accedi di nuovo.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const esito = await confermaCodiceMail(createAdminSupabase(), s.user, s.sessionId, await sessioneVerificata(supabase), body?.codice)
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status })
  return NextResponse.json({ ok: true, nuovo: esito.nuovo })
}
