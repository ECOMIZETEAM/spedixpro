import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// SCRITTURE CONSENTITE ALL'AGENTE.
// L'agente e' di sola lettura, ma alcune rotte usano POST per LEGGERE (preventivi, esportazioni,
// stampe) e una — la creazione spedizione per i SUOI clienti — gli spetta davvero. Tutto il resto
// e' vietato; le rotte qui elencate hanno gia' dentro i propri controlli di perimetro.
const SCRITTURE_AGENTE = [
  '/api/reports/',                    // generazione ed export dei report che puo' scaricare
  '/api/spedizioni/crea',             // spedizione per un suo cliente (la rotta verifica che sia suo)
  '/api/spedizioni/tariffe',          // preventivo: e' una lettura fatta in POST
  '/api/spedizioni/etichetta',        // stampa LDV
  '/api/spedizioni/etichette-bulk',   // stampa massiva
  '/api/spedizioni/tracking',         // consultazione tracking
  '/api/moovy/',                      // assistente (ha i suoi limiti dentro)
  '/api/auth/',                       // uscita/sessione
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ────────────────────────────────────────────────────────────────────────────
  // AGENTE: nessuna scrittura, su NESSUNA rotta.
  //
  // Il confinamento dell'agente era rotta per rotta (lib/agente.ts, bloccaAgente): funziona dove
  // qualcuno si e' ricordato di metterlo, cioe' su 46 rotte su 210. Sulle altre l'agente — che
  // e' un rivenditore esterno, non staff — poteva riscrivere il listino d'acquisto del master,
  // spostare i CAP delle zone (e quindi i prezzi di tutti i clienti), accreditarsi credito,
  // cambiare l'IBAN del master e persino rifarsi i permessi da solo. Una dimenticanza su una
  // rotta nuova ricreerebbe il buco.
  // Qui il divieto e' UNO, sta davanti a tutte le rotte, e vale anche per quelle che nasceranno.
  // Costa una query solo sulle scritture di chi ha una sessione: le letture e le chiamate con
  // api key (/api/v1, autenticate diversamente) non toccano il database.
  if (pathname.startsWith('/api/')) {
    const scrittura = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
    const consentita = SCRITTURE_AGENTE.some(p => pathname.startsWith(p))
    const conSessione = req.cookies.getAll().some(c => c.name.startsWith('sb-'))
    if (!scrittura || consentita || !conSessione) return NextResponse.next()

    const risposta = NextResponse.next({ request: { headers: req.headers } })
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll() },
          setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value, options }) => risposta.cookies.set(name, value, options)) },
        },
      }
    )
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return risposta
    const { data: u } = await sb.from('utenti').select('ruolo, masters(pagamento_scaduto_dal)').eq('id', user.id).single()
    if ((u?.ruolo || '').toLowerCase() === 'agente') {
      return NextResponse.json({ error: 'Operazione non consentita: gli agenti hanno accesso in sola lettura.' }, { status: 403 })
    }

    // ACCOUNT SOSPESO PER CANONE NON PAGATO: non deve poter fare operazioni, e non basta nasconderle
    // a schermo — le chiamate si possono fare lo stesso dagli strumenti del browser.
    //
    // Vale SOLO per chi il canone lo deve pagare, cioe' il master e chi lavora per lui. I suoi
    // CLIENTI hanno lo stesso master_id — nel nostro modello ogni cliente appartiene a un master —
    // quindi senza questo controllo sul ruolo si sarebbero bloccati anche loro, ed e' esattamente
    // il contrario di quello che serve: la rete sotto deve continuare a lavorare, e le sue
    // spedizioni devono continuare a girare nei movimenti del master.
    // Restano aperte le rotte per PAGARE, altrimenti sarebbe un blocco senza uscita.
    const ruoloU = (u?.ruolo || '').toLowerCase()
    const deveLuiPagare = ruoloU === 'master' || ruoloU === 'admin' || ruoloU === 'operatore'
    const scaduto = deveLuiPagare ? (u as any)?.masters?.pagamento_scaduto_dal : null
    if (scaduto && (Date.now() - new Date(scaduto).getTime()) > 3 * 86400000
        && !pathname.startsWith('/api/stripe/') && !pathname.startsWith('/api/auth/')) {
      return NextResponse.json({ error: 'Account sospeso: il canone non risulta pagato. Riattiva il pagamento per continuare.' }, { status: 402 })
    }
    return risposta
  }

  // Le due pagine di ACCESSO. Restano aperte a chi non ha sessione (senza questa esenzione si
  // creava un loop di redirect aprendo l'app da Shopify), ma chi e' GIA' dentro non deve
  // ritrovarsi il modulo di accesso: il cliente lo vedeva perfino dentro la propria sidebar,
  // come se la sessione fosse scaduta. Qui sotto viene mandato alla sua dashboard.
  const isPaginaAccesso = pathname === '/cliente' || pathname === '/'

  // Applichiamo il controllo solo alle aree protette
  const isDashboard = pathname.startsWith('/dashboard')
  const isCliente = pathname.startsWith('/cliente')
  // La schermata dell'autista e' un'area protetta come le altre: senza questo, aperta senza
  // sessione serviva la pagina nuda con dentro un errore, invece di mandare al modulo di accesso.
  const isAutista = pathname.startsWith('/autista')

  if (!isDashboard && !isCliente && !isAutista && !isPaginaAccesso) {
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
    if (ruolo === 'autista') return vaiA('/autista')
    return vaiA(ruolo === 'cliente' ? '/cliente/dashboard' : '/dashboard')
  }

  // Cliente che tenta di accedere all'area master -> rimanda al suo dashboard cliente
  if (isDashboard && ruolo === 'cliente') {
    return vaiA('/cliente/dashboard')
  }

  // L'AUTISTA non entra nel portale: la sua schermata e' quella del telefono. Non e' solo una
  // questione di ordine — il portale mostra prezzi, clienti e conti che a chi guida non servono
  // e non deve vedere.
  if (ruolo === 'autista' && (isDashboard || isCliente)) {
    return vaiA('/autista')
  }

  // ...e chi autista non e' non ha niente da fare nella sua schermata.
  if (isAutista && ruolo !== 'autista') {
    return vaiA(ruolo === 'cliente' ? '/cliente/dashboard' : '/dashboard')
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
  // '/api/:path*' serve al blocco delle scritture dell'agente qui sopra: la funzione esce subito
  // (senza toccare il database) su tutto cio' che non e' una scrittura con sessione.
  matcher: ['/', '/dashboard/:path*', '/cliente/:path*', '/autista/:path*', '/autista', '/api/:path*'],
}
