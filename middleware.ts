import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Le due pagine di ACCESSO. Restano aperte a chi non ha sessione (senza questa esenzione si
  // creava un loop di redirect aprendo l'app da Shopify), ma chi e' GIA' dentro non deve
  // ritrovarsi il modulo di accesso: il cliente lo vedeva perfino dentro la propria sidebar,
  // come se la sessione fosse scaduta. Qui sotto viene mandato alla sua dashboard.
  const isPaginaAccesso = pathname === '/cliente' || pathname === '/'

  // Applichiamo il controllo solo alle aree protette
  const isDashboard = pathname.startsWith('/dashboard')
  const isCliente = pathname.startsWith('/cliente')

  if (!isDashboard && !isCliente && !isPaginaAccesso) {
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

  // I redirect qui sotto devono PORTARSI DIETRO i cookie scritti su `response`.
  // getUser() puo' rinnovare la sessione: in quel caso Supabase ruota il refresh token lato
  // server e scrive la coppia NUOVA su `response`. Se rispondiamo con un redirect creato da zero,
  // quei Set-Cookie non partono, il browser tiene il refresh token ormai consumato e alla
  // richiesta dopo l'utente viene sbattuto fuori senza motivo. E' la stessa classe di errore
  // corretta nelle rotte di accesso, qui nel punto piu' trafficato dell'app.
  const vaiA = (path: string) => {
    const r = NextResponse.redirect(new URL(path, req.url))
    response.cookies.getAll().forEach((c) => r.cookies.set(c))
    return r
  }

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Sulle pagine di accesso e' la situazione normale: si mostra il modulo.
    if (isPaginaAccesso) return response
    // Non autenticato: rimanda al login appropriato
    const loginUrl = isCliente ? '/cliente' : '/'
    return vaiA(loginUrl)
  }

  const { data: utente } = await supabase
    .from('utenti')
    .select('ruolo')
    .eq('id', user.id)
    .single()

  const ruolo = utente?.ruolo

  // Sessione gia' valida su una pagina di accesso: dritto alla propria dashboard, senza far
  // rivedere il modulo di login a chi e' dentro.
  if (isPaginaAccesso) {
    return vaiA(ruolo === 'cliente' ? '/cliente/dashboard' : '/dashboard')
  }

  // Cliente che tenta di accedere all'area master -> rimanda al suo dashboard cliente
  if (isDashboard && ruolo === 'cliente') {
    return vaiA('/cliente/dashboard')
  }

  // Staff che tenta di accedere all'area cliente -> rimanda al suo dashboard master.
  // Prima il rimbalzo valeva solo per 'master': admin, operatore e agente entravano in /cliente/*,
  // dove il layout non trova cliente_id e serve pagine nude, senza sidebar e senza via d'uscita.
  if (isCliente && ruolo && ruolo !== 'cliente') {
    return vaiA('/dashboard')
  }

  return response
}

export const config = {
  // '/' incluso per mandare alla propria dashboard chi e' gia' dentro e riapre il modulo di accesso.
  matcher: ['/', '/dashboard/:path*', '/cliente/:path*'],
}
