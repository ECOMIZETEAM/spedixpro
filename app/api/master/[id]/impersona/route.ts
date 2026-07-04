import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Impersona un master DISCENDENTE (solo discesa nella catena).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/', req.url))

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!utente || utente.ruolo !== 'master') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  const { id } = await params
  const admin = createAdminSupabase()

  // Verifica catena: risalgo dal target; il mio master deve essere un antenato
  let cur: string | null = id
  let inCatena = false
  for (let i = 0; i < 20 && cur; i++) {
    const { data: m } = await admin.from('masters').select('id,parent_master_id').eq('id', cur).maybeSingle()
    if (!m) break
    if (m.parent_master_id === utente.master_id) { inCatena = true; break }
    cur = m.parent_master_id
  }
  if (!inCatena) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=non_autorizzato', req.url))
  }

  // Utente master del target
  const { data: targetUser } = await admin.from('utenti')
    .select('id').eq('master_id', id).eq('ruolo', 'master').limit(1).maybeSingle()
  if (!targetUser) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=utente_master_mancante', req.url))
  }
  const { data: au } = await admin.auth.admin.getUserById(targetUser.id)
  const email = au?.user?.email
  if (!email) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=email_mancante', req.url))
  }

  await supabase.auth.signOut()

  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !linkData?.properties?.hashed_token) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=impersonazione_fallita', req.url))
  }
  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink', token_hash: linkData.properties.hashed_token,
  })
  if (verifyError || !sessionData.session) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=sessione_non_creata', req.url))
  }
  return NextResponse.redirect(new URL('/dashboard', req.url))
}
