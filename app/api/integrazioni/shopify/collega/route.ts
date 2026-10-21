import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { conErrore, conCollegato } from '@/lib/esiti-collegamento'
import { entraNelPortaleDaShopify } from '@/lib/accesso-cliente'
import { creaContoShopify, creazioneContoDisponibile } from '@/lib/shopifyProvision'
import {
  PAGINA_SCELTA, type Sospeso, attendiCollegamento, azzeraSospesoShopify, collegaNegozioShopify, consumaSospeso,
  contaTentativoSbagliato, gettoneModuloShopify, gettoneModuloValido, sessioneNelBrowser, sospesoDelBrowser,
  verificaContoCliente,
} from '@/lib/shopifyCollega'
import {
  type EsitoScelta, esitoDelModuloAccedi, esitoScelta, paginaInstallazioneScaduta, paginaProblemaTemporaneo, paginaSceltaAccount,
} from '@/lib/shopify-pagina-scelta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// «HAI GIÀ UN ACCOUNT MOOVEXPRESS?»: la scelta di un negozio Shopify MAI VISTO, dopo l'autorizzazione.
//
// Decisione D1 di Lorenzo del 21/10/2026. Il callback, per un negozio che non e' legato a nessun conto, non
// crea piu' niente: mette il token da parte (lib/shopifyCollega.ts) e manda qui. Tre strade:
// - «Collega al conto …»: nel browser c'e' gia' un cliente; il negozio va a lui, coi suoi prezzi;
// - «Sì, accedo»: email e password di un conto cliente esistente, sotto il suo master e ai suoi prezzi;
// - «No, crea il mio account»: il conto nuovo sotto il master dei negozi (MOOVY), con l'accesso automatico.
// Prima l'installazione senza sessione creava sempre un conto nuovo, e chi ne aveva gia' uno si ritrovava
// un secondo conto vuoto sotto un'altra rete. E lo state col cliente dentro non basta piu' ad agganciare:
// veniva dalla sessione di /enter, che puo' essere di chiunque abbia usato quel browser.
//
// GET serve la pagina, POST le sue tre azioni. Ogni POST risponde 303: dopo un 307 il browser ripeterebbe il
// POST sulla pagina d'arrivo (e' successo al login master, app/api/auth/login).

export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  const q = req.nextUrl.searchParams
  const esito = esitoScelta(q.get('esito'))

  const letto = await sospesoDelBrowser(admin, req)
  if (letto.stato === 'illeggibile') return paginaProblemaTemporaneo()
  if (letto.stato === 'assente') return azzeraSospesoShopify(paginaInstallazioneScaduta(esito === 'troppi_tentativi' ? esito : null))
  const s = letto.sospeso
  if (!process.env.SHOPIFY_API_SECRET) {
    console.error('[SHOPIFY][SCELTA] SHOPIFY_API_SECRET assente: moduli non firmabili', s.shop)
    return paginaProblemaTemporaneo()
  }

  const [sessione, creazione] = await Promise.all([sessioneNelBrowser(admin, req), creazioneContoDisponibile(admin)])
  return paginaSceltaAccount({
    shop: s.shop,
    esito,
    conto: sessione.tipo === 'cliente'
      ? { ragioneSociale: sessione.ragioneSociale, codiceCliente: sessione.codiceCliente, gettone: gettoneModuloShopify(s, 'conferma', sessione.clienteId) }
      : null,
    // L'esito di un accesso non riuscito si mostra sopra il modulo d'accesso, anche se il rimando ha perso
    // ?altro=1: sul conto gia' aperto un clic per «riprovare» collegherebbe il negozio a quel conto.
    altroAccount: q.get('altro') === '1' || esitoDelModuloAccedi(esito),
    nota: sessione.tipo === 'non_collegabile' ? sessione.motivo : null,
    gettoneAccedi: gettoneModuloShopify(s, 'accedi'),
    creazione: creazione === 'si' ? { stato: 'si', gettone: gettoneModuloShopify(s, 'crea') } : { stato: creazione },
  })
}

const negozio = (s: Sospeso) => s.shop as `${string}.myshopify.com`
const verso = (req: NextRequest, percorso: string) => NextResponse.redirect(new URL(percorso, req.url), 303)
// Gli esiti dei moduli tornano sulla pagina come codice (?esito=), tradotto da lib/shopify-pagina-scelta.ts.
// `altro`: il modulo partiva da «Usa un altro account», e la pagina ci torna (?altro=1) finche' nel browser
// c'e' la sessione di prima. Non dopo un accesso riuscito: li' il conto aperto e' quello appena scelto.
const allaPagina = (req: NextRequest, esito?: EsitoScelta, altro = false) => {
  const q = new URLSearchParams()
  if (esito) q.set('esito', esito)
  if (altro) q.set('altro', '1')
  const s = q.toString()
  return verso(req, s ? `${PAGINA_SCELTA}?${s}` : PAGINA_SCELTA)
}

export async function POST(req: NextRequest) {
  const admin = createAdminSupabase()

  // I moduli devono venire dalla pagina qui sopra. Un browser che lo dice (Sec-Fetch-Site) deve dire «stesso
  // sito»; in ogni caso decidono il cookie dell'installazione (SameSite=Lax: non parte coi moduli di un altro
  // sito) e il gettone del modulo, che solo la pagina servita a questo browser puo' avere.
  const sito = req.headers.get('sec-fetch-site')
  if (sito && sito !== 'same-origin') return allaPagina(req, 'richiesta_non_valida')

  const form = await req.formData().catch(() => null)
  const azione = String(form?.get('azione') || '')
  const gettone = String(form?.get('gettone') || '')
  const altro = String(form?.get('altro') || '') === '1'

  const letto = await sospesoDelBrowser(admin, req)
  if (letto.stato === 'illeggibile') return allaPagina(req, 'temporaneo', altro)
  if (letto.stato === 'assente') return azzeraSospesoShopify(allaPagina(req))
  const s = letto.sospeso

  if (azione === 'conferma') return conferma(req, admin, s, gettone)
  if (azione === 'accedi') return accedi(req, admin, s, gettone, form, altro)
  if (azione === 'crea') return crea(req, admin, s, gettone, altro)
  return allaPagina(req, 'richiesta_non_valida')
}

// IL DOPPIO INVIO: l'installazione l'ha gia' consumata l'invio prima, che sta finendo il collegamento. Se il
// negozio risulta collegato al conto di questa richiesta, l'esito e' lo stesso; altrimenti la pagina dice
// che l'installazione non c'e' piu'.
async function giaConsumato(req: NextRequest, admin: any, s: Sospeso, clienteId: string): Promise<NextResponse> {
  const collegatoA = await attendiCollegamento(admin, s.shop)
  return azzeraSospesoShopify(collegatoA === clienteId ? verso(req, conCollegato('/cliente/integrazioni', negozio(s))) : allaPagina(req))
}

// «COLLEGA AL CONTO …»: il cliente gia' entrato. Il gettone porta il suo id: se nel frattempo nel browser e'
// entrato un altro conto, il negozio non va a un conto diverso da quello scritto sul pulsante.
async function conferma(req: NextRequest, admin: any, s: Sospeso, gettone: string): Promise<NextResponse> {
  const sessione = await sessioneNelBrowser(admin, req)
  if (sessione.tipo !== 'cliente' || !gettoneModuloValido(gettone, s, 'conferma', sessione.clienteId)) {
    return allaPagina(req, 'sessione_cambiata')
  }
  const presa = await consumaSospeso(admin, s)
  if (presa.esito === 'illeggibile') return allaPagina(req, 'temporaneo')
  if (presa.esito === 'gia_usato') return giaConsumato(req, admin, s, sessione.clienteId)
  const esito = await collegaNegozioShopify(admin, { shop: s.shop, clienteId: sessione.clienteId, credenziali: presa.credenziali })
  return azzeraSospesoShopify(verso(req, esito.ok
    ? conCollegato('/cliente/integrazioni', negozio(s))
    : conErrore('/cliente/integrazioni', esito.codice)))
}

// Un rifiuto di Supabase Auth che non dice niente della password (troppe richieste, guasto, rete) non e' un
// tentativo sbagliato: contarlo farebbe annullare l'installazione a chi non ha sbagliato niente.
function guastoDiAccesso(error: any): boolean {
  const st = error?.status
  return typeof st !== 'number' || st === 0 || st === 429 || st >= 500
}

// «SÌ, ACCEDO»: email e password di un conto che esiste gia'.
//
// I cookie della sessione nuova si tengono da parte e vanno sulla risposta SOLO se il conto puo' ricevere il
// negozio. Se no (staff, conto spento, prova) la sessione appena aperta si chiude (signOut locale, come il
// modulo d'accesso clienti) e il browser resta com'era, compresa l'eventuale sessione di prima: l'installazione
// resta valida e la pagina spiega perche'. Da qui non si legge la sessione gia' aperta nel browser: un suo
// rinnovo scriverebbe sulla risposta i cookie del conto di prima DOPO quelli del conto appena entrato.
async function accedi(req: NextRequest, admin: any, s: Sospeso, gettone: string, form: FormData | null, altro: boolean): Promise<NextResponse> {
  if (!gettoneModuloValido(gettone, s, 'accedi')) return allaPagina(req, 'modulo_scaduto', altro)
  // Stessa normalizzazione del modulo d'accesso: dal telefono l'email arriva spesso con la maiuscola o uno spazio.
  const email = String(form?.get('email') || '').trim().toLowerCase()
  const password = String(form?.get('password') || '')
  if (!email || !password || email.length > 200 || password.length > 200) return allaPagina(req, 'credenziali', altro)

  const raccolti: { name: string; value: string; options: any }[] = []
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll(daScrivere) { raccolti.push(...daScrivere) },
    },
  })
  const conSessione = (r: NextResponse) => { for (const c of raccolti) r.cookies.set(c.name, c.value, c.options); return r }

  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data?.user || !data?.session) {
    // Nel log l'indirizzo, come il modulo d'accesso clienti, mai la password.
    if (guastoDiAccesso(error)) {
      console.error('[SHOPIFY][SCELTA] accesso non verificabile', s.shop, { email, motivo: error?.message, status: (error as any)?.status })
      return allaPagina(req, 'temporaneo', altro)
    }
    console.warn('[SHOPIFY][SCELTA] accesso non riuscito', s.shop, { email, motivo: error?.message })
    const conto = await contaTentativoSbagliato(admin, s)
    if (conto === 'esaurito') return azzeraSospesoShopify(allaPagina(req, 'troppi_tentativi'))
    return allaPagina(req, 'credenziali', altro)
  }

  const chi = await verificaContoCliente(admin, data.user.id)
  if (!chi.ok) {
    await sb.auth.signOut({ scope: 'local' }).catch(() => null)
    console.warn('[SHOPIFY][SCELTA] il conto non puo\' ricevere il negozio', s.shop, { email, motivo: chi.motivo })
    return allaPagina(req, chi.motivo, altro)
  }

  const presa = await consumaSospeso(admin, s)
  // Entrato ma non collegato: con la sessione nuova la pagina offre «Collega al conto», un clic per riprovare.
  if (presa.esito === 'illeggibile') return conSessione(allaPagina(req, 'temporaneo'))
  if (presa.esito === 'gia_usato') return conSessione(await giaConsumato(req, admin, s, chi.clienteId))
  const esito = await collegaNegozioShopify(admin, { shop: s.shop, clienteId: chi.clienteId, credenziali: presa.credenziali })
  return azzeraSospesoShopify(conSessione(verso(req, esito.ok
    ? conCollegato('/cliente/integrazioni', negozio(s))
    : conErrore('/cliente/integrazioni', esito.codice))))
}

// «NO, CREA IL MIO ACCOUNT»: il conto nuovo sotto il master dei negozi. L'installazione si consuma PRIMA di
// creare: un secondo clic non trova piu' niente e non crea un secondo conto. Poi si entra come entra ogni
// conto nato da Shopify, con l'accesso automatico (regola D5, lib/accesso-cliente.ts), con un 303; se nel
// browser c'e' la sessione di un'altra persona, prima la pagina di conferma.
async function crea(req: NextRequest, admin: any, s: Sospeso, gettone: string, altro: boolean): Promise<NextResponse> {
  if (!gettoneModuloValido(gettone, s, 'crea')) return allaPagina(req, 'modulo_scaduto', altro)
  const disponibile = await creazioneContoDisponibile(admin)
  if (disponibile === 'no') return allaPagina(req, 'creazione_non_disponibile', altro)
  if (disponibile === 'non_so') return allaPagina(req, 'temporaneo', altro)

  const presa = await consumaSospeso(admin, s)
  if (presa.esito === 'illeggibile') return allaPagina(req, 'temporaneo', altro)
  if (presa.esito === 'gia_usato') {
    const collegatoA = await attendiCollegamento(admin, s.shop)
    return azzeraSospesoShopify(collegatoA
      ? await entraNelPortaleDaShopify(req, admin, { clienteId: collegatoA, shop: s.shop, status: 303 })
      : allaPagina(req))
  }

  // Da qui l'installazione non c'e' piu': un errore manda a riaprire l'app dall'admin del negozio, che rifa'
  // l'autorizzazione e ritrova il conto, se e' nato (trovaContoDelNegozio, per indirizzo).
  const conto = await creaContoShopify(admin, s.shop, presa.credenziali.access_token)
  if ('error' in conto) {
    console.error('[SHOPIFY][SCELTA] conto non creato', s.shop, conto.codice, conto.error)
    return azzeraSospesoShopify(verso(req, conErrore('/cliente', conto.codice)))
  }
  const esito = await collegaNegozioShopify(admin, { shop: s.shop, clienteId: conto.clienteId, credenziali: presa.credenziali })
  if (!esito.ok) return azzeraSospesoShopify(verso(req, conErrore('/cliente', esito.codice)))
  return azzeraSospesoShopify(await entraNelPortaleDaShopify(req, admin, { clienteId: conto.clienteId, shop: s.shop, status: 303 }))
}
