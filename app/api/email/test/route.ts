import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { inviaEmailTest } from '@/lib/email'

// Invia un'email di prova per verificare il mittente/dominio Resend.
// Apri nel browser (loggato come master): /api/email/test?to=indirizzo@esempio.com
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const to = (req.nextUrl.searchParams.get('to') || user.email || '').trim()
  if (!to) return NextResponse.json({ error: 'Indirizzo destinatario mancante (?to=...)' }, { status: 400 })

  const esito = await inviaEmailTest(to)
  return NextResponse.json({ ...esito, to })
}
