import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Logga il merchant (via magic-link) e ritorna una redirect con i cookie di sessione
// già attaccati, così il portale si apre GIÀ loggato (no login manuale, no App Bridge).
export async function loginMerchantERedirect(req: NextRequest, email: string, to: string): Promise<NextResponse> {
  const redirect = NextResponse.redirect(new URL(to, req.url))
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => redirect.cookies.set(name, value, options))
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

  return redirect
}
