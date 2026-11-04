import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// A che punto e' la verifica in due passaggi di chi chiede: serve alla pagina del codice e
// all'avviso nelle aree master e cliente. Risponde anche a chi non ha ancora messo il codice: le
// rotte /api/accesso/ sono fra quelle che il middleware lascia passare.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const attiva = (user.factors || []).some((f: any) => f.status === 'verified')
  // La data di obbligo la decide Lorenzo e sta in una tabella che nessun utente puo' leggere.
  const { data: imp } = await createAdminSupabase().from('sicurezza_impostazioni').select('mfa_obbligatoria_dal').maybeSingle()
  const dal: string | null = (imp as any)?.mfa_obbligatoria_dal || null
  return NextResponse.json({ attiva, obbligatoriaDal: dal, obbligatoria: !!dal && new Date(dal).getTime() <= Date.now() })
}
