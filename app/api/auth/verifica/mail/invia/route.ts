import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaCodiceMail, sessioneDellaRichiesta, sessioneVerificata } from '@/lib/verifica-metodi'

// Manda il codice via mail (lib/verifica-metodi). Tutte le rotte della verifica stanno sotto /api/auth/:
// le chiama chi non ha ancora messo il codice, anche con il canone da pagare o senza piano, e il
// middleware lascia passare solo queste.
export async function POST() {
  const supabase = await createServerSupabase()
  const s = await sessioneDellaRichiesta(supabase)
  if (!s) return NextResponse.json({ error: 'Sessione scaduta: accedi di nuovo.' }, { status: 401 })
  const esito = await inviaCodiceMail(createAdminSupabase(), s.user, s.sessionId, await sessioneVerificata(supabase))
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status })
  return NextResponse.json({ ok: true, a: esito.a, giaInviato: !!esito.giaInviato })
}
