import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // La pagina di login cliente (/cliente esatto) resta accessibile senza sessione,
  // altrimenti loop di redirect (ERR_TOO_MANY_REDIRECTS) quando si apre l'app da Shopify.
  if (pathname === '/cliente') {
    return NextResponse.next()
  }

  // Applichiamo il controllo solo alle aree protette
  const isDashboard = pathname.startsWith('/dashboard')
  const isCliente = pathname.startsWith('/cliente')

  if (!isDashboard && !isCliente) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request: { headers: req.headers } })
  response.headers.set('x-pathname', pathname)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Non autenticato: rimanda al login appropriato
    const loginUrl = isCliente ? '/cliente' : '/'
    return NextResponse.redirect(new URL(loginUrl, req.url))
  }

  const { data: utente } = await supabase
    .from('utenti')
    .select('ruolo')
    .eq('id', user.id)
    .single()

  const ruolo = utente?.ruolo

  // Cliente che tenta di accedere all'area master -> rimanda al suo dashboard cliente
  if (isDashboard && ruolo === 'cliente') {
    return NextResponse.redirect(new URL('/cliente/dashboard', req.url))
  }

  // Master che tenta di accedere all'area cliente -> rimanda al suo dashboard master
  if (isCliente && (ruolo === 'master')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/cliente/:path*'],
}
