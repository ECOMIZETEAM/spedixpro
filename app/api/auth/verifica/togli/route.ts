import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sessioneDellaRichiesta, sessioneVerificata, togliMetodo } from '@/lib/verifica-metodi'

// Toglie l'app o la mail dalle impostazioni: ne deve restare almeno uno.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await sessioneDellaRichiesta(supabase)
  if (!s) return NextResponse.json({ error: 'Sessione scaduta: accedi di nuovo.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const esito = await togliMetodo(createAdminSupabase(), s.user, String(body?.metodo || ''), await sessioneVerificata(supabase))
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status })
  return NextResponse.json({ ok: true })
}
