import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // La response finale (redirect) DEVE portare i cookie della nuova sessione:
  // leghiamo la scrittura dei cookie a questo oggetto, così il primo render lato
  // server di /cliente/dashboard vede già la sessione (sidebar subito, senza refresh).
  const okRedirect = NextResponse.redirect(new URL('/cliente/dashboard', req.url))
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => okRedirect.cookies.set(name, value, options))
        },
      },
    }
  )

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

  // Account di accesso REALE del cliente (utenti -> auth.users): usiamo l'email effettiva
  // del login, robusta anche se clienti.email è disallineata o non valida, e NON creiamo
  // utenti fantasma. Se il cliente non ha un login valido, torniamo alla lista SENZA
  // sloggare il master (altrimenti si finirebbe sulla pagina di login).
  const { data: uCli } = await admin.from('utenti').select('id').eq('cliente_id', cliente.id).limit(1).maybeSingle()
  let loginEmail: string | null = null
  if (uCli?.id) {
    const { data: au } = await admin.auth.admin.getUserById((uCli as any).id)
    loginEmail = au?.user?.email || null
  }
  if (!loginEmail) {
    return NextResponse.redirect(new URL('/dashboard/clienti?erroreAccesso=cliente_senza_login', req.url))
  }

  // logout della sessione master, poi login come cliente (i cookie finiscono su okRedirect)
  await supabase.auth.signOut()

  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: loginEmail,
  })
  if (error || !linkData) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=impersonazione_fallita', req.url))
  }
  const tokenHash = linkData.properties?.hashed_token
  if (!tokenHash) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=token_mancante', req.url))
  }

  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink', token_hash: tokenHash,
  })
  if (verifyError || !sessionData.session) {
    return NextResponse.redirect(new URL('/dashboard/clienti?error=sessione_non_creata', req.url))
  }

  return okRedirect
}
