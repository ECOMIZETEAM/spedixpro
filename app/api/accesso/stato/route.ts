import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { metodiDi } from '@/lib/verifica-metodi'

// A che punto e' la verifica in due passaggi di chi chiede: serve alla pagina del codice, alla sezione
// nelle impostazioni e all'avviso nelle aree master e cliente. Risponde anche a chi non ha ancora messo il
// codice: le rotte /api/accesso/ sono fra quelle che il middleware lascia passare.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const admin = createAdminSupabase()
  // I metodi attivati (lib/verifica-metodi): l'app, la mail, quanti codici di riserva restano.
  const metodi = await metodiDi(admin, user)
  // La data di obbligo la decide Lorenzo e sta in una tabella che nessun utente puo' leggere.
  const { data: imp } = await admin.from('sicurezza_impostazioni').select('mfa_obbligatoria_dal').maybeSingle()
  const dal: string | null = (imp as { mfa_obbligatoria_dal?: string | null } | null)?.mfa_obbligatoria_dal || null
  return NextResponse.json({
    attiva: metodi.app || metodi.mail, metodi,
    obbligatoriaDal: dal, obbligatoria: !!dal && new Date(dal).getTime() <= Date.now(),
  })
}
