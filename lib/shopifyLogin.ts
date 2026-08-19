import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Logga il merchant (via magic-link) e ritorna una redirect con i cookie di sessione
// già attaccati, così il portale si apre GIÀ loggato (no login manuale, no App Bridge).
export async function loginMerchantERedirect(req: NextRequest, email: string, to: string): Promise<NextResponse> {
  const redirect = NextResponse.redirect(new URL(to, req.url))
  // Nomi dei cookie della NUOVA sessione: servono per NON cancellarli nella pulizia qui sotto.
  const nuoviNomi = new Set<string>()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => { redirect.cookies.set(name, value, options); nuoviNomi.add(name) })
        },
      },
    }
  )

  const admin = createAdminSupabase()
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = linkData?.properties?.hashed_token
  if (error || !tokenHash) return NextResponse.redirect(new URL('/cliente?error=login_shopify', req.url))

  const { data: s, error: vErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (vErr || !s.session) return NextResponse.redirect(new URL('/cliente?error=login_shopify', req.url))

  // PULIZIA CHUNK DI SESSIONE VECCHI. Supabase spezza la sessione in cookie `sb-...-auth-token.0/.1/...`;
  // a ogni nuovo login magic-link (auto-provision Shopify) i chunk della sessione precedente NON
  // vengono azzerati e si ACCUMULANO. Dopo qualche tentativo di collegamento gli header di richiesta
  // diventano enormi e il portale risponde HTTP 431 "Request Header Fields Too Large" — cioe' il "la
  // pagina non funziona" che il reviewer Shopify ha visto al "Connect shop". Qui, dopo aver impostato
  // la sessione nuova, scadenziamo i soli cookie `sb-*` NON appartenenti a questa sessione: la nuova
  // resta valida, i residui spariscono, gli header tornano piccoli. Scoped al solo auto-login Shopify.
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-') && !nuoviNomi.has(c.name)) {
      redirect.cookies.set(c.name, '', { maxAge: 0, path: '/' })
    }
  }

  return redirect
}
