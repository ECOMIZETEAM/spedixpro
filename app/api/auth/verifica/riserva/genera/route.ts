import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { generaCodiciRiserva, sessioneDellaRichiesta, sessioneVerificata } from '@/lib/verifica-metodi'

// 10 codici di riserva nuovi (i vecchi non usati smettono di valere). Si vedono SOLO in questa risposta.
export async function POST() {
  const supabase = await createServerSupabase()
  const s = await sessioneDellaRichiesta(supabase)
  if (!s) return NextResponse.json({ error: 'Sessione scaduta: accedi di nuovo.' }, { status: 401 })
  const esito = await generaCodiciRiserva(createAdminSupabase(), s.user, await sessioneVerificata(supabase))
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status })
  return NextResponse.json({ ok: true, codici: esito.codici }, { headers: { 'Cache-Control': 'no-store' } })
}
