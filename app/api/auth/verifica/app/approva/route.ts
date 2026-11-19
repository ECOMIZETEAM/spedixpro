import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { approvaApp, sessioneDellaRichiesta, sessioneVerificata } from '@/lib/verifica-metodi'

// L'app appena attivata dalla pagina del codice: il portale la riconosce (scripts/verifica-metodi.sql).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await sessioneDellaRichiesta(supabase)
  if (!s) return NextResponse.json({ error: 'Sessione scaduta: accedi di nuovo.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const esito = await approvaApp(createAdminSupabase(), s.user, String(body?.factorId || ''), await sessioneVerificata(supabase))
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status })
  return NextResponse.json({ ok: true })
}
