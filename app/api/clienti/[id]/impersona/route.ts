import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/', req.url))

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!utente || utente.ruolo === 'cliente') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  const { id } = await params

  const { data: cliente } = await supabase
    .from('clienti').select('id,email,master_id').eq('id', id).single()

  if (!cliente || cliente.master_id !== utente.master_id) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=non_autorizzato', req.url))
  }

  const admin = createAdminSupabase()

  // *** FIX: logout esplicito della sessione master prima di impersonare ***
  await supabase.auth.signOut()

  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: cliente.email,
  })

  if (error || !linkData) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=impersonazione_fallita', req.url))
  }

  const tokenHash = linkData.properties?.hashed_token
  if (!tokenHash) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=token_mancante', req.url))
  }

  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })

  if (verifyError || !sessionData.session) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=sessione_non_creata', req.url))
  }

  return NextResponse.redirect(new URL('/cliente/dashboard', req.url))
}
