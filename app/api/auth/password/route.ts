import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { controlliCambioPassword, metodiSessione } from '@/lib/password-cambio'
import { messaggioErrorePassword } from '@/lib/password-regole'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// CAMBIO PASSWORD DELL'UTENTE: l'unica porta da cui si sceglie la propria password (Cambio password
// nelle impostazioni, link di recupero e di invito, cambio chiesto all'accesso). Prima le pagine
// chiamavano Supabase direttamente dal browser e nessuno poteva controllare riuso, nome ed eta'
// minima (politica Amazon sui dati, 1.4.1): qui si controlla, poi si cambia con la sessione
// dell'utente, cosi' Supabase fa anche i suoi controlli (complessita', password rubate).
// Sta sotto /api/auth/ come prima stava nel browser: raggiungibile anche prima del codice della
// verifica in due passaggi, perche' chi apre il link di recupero non l'ha ancora messo.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sessione scaduta: rientra e riprova.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''

  const admin = createAdminSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  const metodi = metodiSessione(session?.access_token)
  const daLink = !metodi.includes('password')
  const { data: riga } = await admin.from('utenti').select('nome, cognome').eq('id', user.id).maybeSingle()

  const no = await controlliCambioPassword(admin, { id: user.id, email: user.email, nome: riga?.nome, cognome: riga?.cognome }, password, daLink)
  if (no) return NextResponse.json({ error: no }, { status: 400 })

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.warn('[PASSWORD] cambio rifiutato da Supabase:', user.id, error.message)
    return NextResponse.json({ error: messaggioErrorePassword(error.message) }, { status: 400 })
  }

  // Dopo il cambio: quella password l'ha scelta l'utente (eta' minima) e il registro accessi lo dice.
  // Il cambio e' gia' fatto: un errore qui si scrive nel log e basta.
  const [segna, registro] = await Promise.all([
    admin.rpc('password_scelta_da_utente', { p_utente: user.id }),
    admin.from('audit_accessi').insert({ utente_id: user.id, azione: 'password_cambiata', risorsa: daLink ? 'link' : 'portale' }),
  ])
  if (segna.error) console.error('[PASSWORD] cambio non segnato come scelto dall\'utente:', user.id, segna.error.message)
  if (registro.error) console.error('[PASSWORD] cambio non scritto nel registro accessi:', user.id, registro.error.message)
  return NextResponse.json({ ok: true })
}
