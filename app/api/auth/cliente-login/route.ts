import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// ACCESSO portale cliente.
// Come per l'area master: i cookie della sessione vanno scritti SULLA RESPONSE che torniamo,
// altrimenti la prima pagina caricata dopo l'accesso viene resa senza utente e il portale
// compare senza sidebar (il layout, non trovando il cliente, mostra solo il contenuto).
export async function POST(req: NextRequest) {
  const body = await req.json()
  // Stessa normalizzazione dell'accesso master: spazi e maiuscole non devono bloccare nessuno.
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  const ok = NextResponse.json({ ok: true })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => ok.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.warn('[LOGIN][CLIENTE][FALLITO]', { email, motivo: error.message })
    return NextResponse.json({ error: 'Email o password non corretti' }, { status: 401 })
  }
  const { data: utente } = await supabase.from('utenti').select('ruolo,cliente_id').eq('id', data.user.id).single()
  if (!utente?.cliente_id) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Accesso non autorizzato' }, { status: 403 })
  }
  return ok
}
