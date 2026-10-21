import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { emailContoShopify, recapitoEmail } from '@/lib/indirizzi-interni'
import { createServerSupabase } from '@/lib/supabase'
import { contoNatoDaShopify } from '@/lib/conti-shopify'
import { loginMerchantERedirect, type StatoRedirect } from '@/lib/shopifyLogin'
import { conErrore } from '@/lib/esiti-collegamento'
// La pagina di conferma sta con le altre pagine Shopify. lib/shopify-pagina-scelta.ts importa
// lib/shopifyCollega.ts, che importa questo file: il giro e' innocuo, perche' nessuno dei tre usa gli altri
// mentre si carica, solo dentro le funzioni.
import { paginaConfermaIngresso } from '@/lib/shopify-pagina-scelta'

// L'ACCESSO DI UN CLIENTE: la sua riga in `utenti` e l'utente di autenticazione che le corrisponde.
//
// Per entrare al posto di un cliente (impersona del master, accesso automatico da Shopify) si usa
// l'email EFFETTIVA del login, letta da auth.users, non clienti.email: e' robusta anche se
// clienti.email e' disallineata o non valida, e non crea utenti fantasma. Il magic link chiesto per
// un'email che non ha un utente non fallisce: generateLink 'magiclink' crea l'utente (lo dice la
// libreria: "handles the creation of the user for signup, invite and magiclink"), senza riga in
// `utenti` — un portale senza menu. Il 19/10 26 clienti attivi su 1.894 non avevano un utente con la
// stessa email del cliente (NMC-14).
//
// Si legge la riga col ruolo 'cliente' (il 20/10 tutte le 1.878 righe con cliente_id lo erano, e
// nessun cliente ne aveva due) e, se mai ce ne fossero due, la piu' recente: e' quella che una
// riparazione dell'accesso ha appena creato, mentre una piu' vecchia puo' puntare a un utente di
// autenticazione che non c'e' piu'.
//
// I tre esiti restano distinti perche' chi DECIDE qualcosa sull'accesso (l'installazione Shopify, che
// lo crea oppure rifiuta il conto: lib/shopifyProvision.ts) non puo' prendere una lettura fallita per
// «nessun accesso». Chi deve solo entrare usa accessoDelCliente, qui sotto.
export type LetturaAccesso =
  | { esito: 'presente'; utenteId: string; email: string }
  | { esito: 'assente'; anomalia?: string }
  | { esito: 'illeggibile'; motivo: string }

export async function leggiAccessoDelCliente(admin: any, clienteId: string): Promise<LetturaAccesso> {
  const { data: u, error } = await admin.from('utenti').select('id')
    .eq('cliente_id', clienteId).eq('ruolo', 'cliente')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return { esito: 'illeggibile', motivo: `lettura utenti: ${error.message}` }
  if (!u?.id) return { esito: 'assente' }
  const { data: au, error: aErr } = await admin.auth.admin.getUserById(u.id)
  // La riga c'e' ma il suo utente di autenticazione e' stato cancellato: con quella riga non entra
  // nessuno, quindi l'accesso non c'e' (e chi lo ripara ne crea uno nuovo). Ogni altro errore resta un
  // «non so».
  if (aErr?.code === 'user_not_found' || aErr?.status === 404) {
    return { esito: 'assente', anomalia: 'riga utenti senza utente di autenticazione' }
  }
  const email = String(au?.user?.email || '').trim().toLowerCase()
  if (aErr || !email) return { esito: 'illeggibile', motivo: `utente di autenticazione: ${aErr?.message || 'email vuota'}` }
  return { esito: 'presente', utenteId: u.id, email }
}

export async function accessoDelCliente(admin: any, clienteId: string): Promise<{ utenteId: string; email: string } | null> {
  const a = await leggiAccessoDelCliente(admin, clienteId)
  if (a.esito === 'presente') return { utenteId: a.utenteId, email: a.email }
  const nota = a.esito === 'illeggibile' ? a.motivo : a.anomalia
  if (nota) console.error('[ACCESSO CLIENTE]', clienteId, nota)
  return null
}

// UN ACCESSO NUOVO NASCE SOLO SU UN INDIRIZZO VERO.
//
// Un utente di login su un indirizzo inventato da noi (lib/indirizzi-interni.ts) e' un accesso che non
// controlla nessuno: il recupero nativo di Supabase (/auth/v1/recover con la chiave pubblica) non passa
// dal nostro codice e spedisce il link a quell'indirizzo, quindi entra chi ne riceve la posta. Su
// moovexpress.app, che non e' nostro, e' chiunque lo registri: il 20/10 DL-TEST di LOGIXIA (a fattura,
// senza accesso, email sul dominio vecchio) aveva il pulsante «Accedi», che glielo avrebbe creato con
// un clic. Restituisce l'indirizzo su cui creare l'accesso, oppure null se non se ne crea nessuno.
// L'unica eccezione e' il conto nato dall'installazione Shopify (assicuraAccesso in
// lib/shopifyProvision.ts): il suo accesso sta per forza sull'indirizzo del negozio, sul sottodominio
// nostro senza posta, e il negoziante entra solo con l'accesso automatico.
export function emailPerNuovoAccesso(email: string | null | undefined): string | null {
  return recapitoEmail(email) || null
}

// CHI E' GIA' DENTRO, IN QUESTO BROWSER, COME CLIENTE.
//
// Conta solo un utente col ruolo 'cliente' e il suo cliente. Master, admin, operatori, agenti e autisti
// valgono come «nessuno»: un negozio Shopify si collega solo a un conto cliente, e loro un cliente non ce
// l'hanno (il 21/10 nessuno di loro aveva cliente_id, e ogni utente 'cliente' ne aveva uno). E' la regola che /install
// applicava prima di avviare l'autorizzazione, ora in un posto solo per l'ingresso e per il collegamento.
// La sessione la verifica Supabase Auth (getUser, non getSession, che si fida del cookie); riga e cliente si
// leggono col client di servizio per l'id appena verificato. Se getUser rinnova la sessione, i cookie nuovi
// partono con la risposta della rotta: Next unisce quelli scritti con cookies() a quella che restituisce.
// Una lettura fallita vale «nessuno»: chi chiama non collega e non fa entrare niente in piu'.
export async function clienteDellaSessione(admin: any): Promise<{ utenteId: string; clienteId: string; masterId: string | null } | null> {
  let utenteId: string | null = null
  try {
    const { data } = await (await createServerSupabase()).auth.getUser()
    utenteId = data?.user?.id || null
  } catch {
    return null
  }
  if (!utenteId) return null
  const { data: u, error } = await admin.from('utenti').select('ruolo,cliente_id').eq('id', utenteId).maybeSingle()
  if (error) {
    console.error('[ACCESSO CLIENTE] lettura dell\'utente della sessione', utenteId, error.message)
    return null
  }
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) return null
  const clienteId = String(u.cliente_id)
  const { data: c } = await admin.from('clienti').select('master_id').eq('id', clienteId).maybeSingle()
  return { utenteId, clienteId, masterId: c?.master_id || null }
}

// CHI E' DENTRO IN QUESTO BROWSER, CON QUALUNQUE RUOLO, SENZA SCRIVERE SULLA RISPOSTA DELLA ROTTA.
//
// Serve prima dell'accesso automatico da Shopify, che sostituisce la sessione del browser con quella del conto
// del negozio. Non passa da cookies() di next/headers come clienteDellaSessione: se la verifica rinnova la
// sessione, i cookie rinnovati finirebbero da soli sulla risposta, accanto a quelli della sessione nuova. Qui
// restano da parte (`cookie`), e chi lascia la sessione com'e' li scrive sulla propria risposta (conCookie):
// senza, il browser terrebbe un refresh token gia' usato, e alla richiesta dopo si ritroverebbe fuori.
// 'nessuno': nessun cookie di sessione, o una sessione che Supabase Auth dice scaduta o revocata (4xx).
// 'illeggibile': c'e' un cookie di sessione ma Supabase Auth non ha risposto (rete, 5xx, troppe richieste).
// Non vale «nessuno»: chi deve decidere se sostituire la sessione di qualcuno non lo fa al buio.
type CookieDaScrivere = { name: string; value: string; options: any }
export type UtenteDelBrowser =
  | { stato: 'nessuno' }
  | { stato: 'illeggibile' }
  | { stato: 'utente'; utenteId: string; email: string; cookie: CookieDaScrivere[] }

export async function utenteDelBrowser(req: NextRequest): Promise<UtenteDelBrowser> {
  if (!req.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))) return { stato: 'nessuno' }
  const cookie: CookieDaScrivere[] = []
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll(daScrivere) { cookie.push(...daScrivere) },
    },
  })
  try {
    const { data, error } = await sb.auth.getUser()
    if (data?.user?.id) return { stato: 'utente', utenteId: data.user.id, email: String(data.user.email || ''), cookie }
    const st = (error as any)?.status
    if (!error || (typeof st === 'number' && st >= 400 && st < 500 && st !== 429)) return { stato: 'nessuno' }
    console.error('[ACCESSO CLIENTE] sessione del browser non verificabile', error.message, st)
    return { stato: 'illeggibile' }
  } catch (e: any) {
    console.error('[ACCESSO CLIENTE] sessione del browser non verificabile', e?.message || e)
    return { stato: 'illeggibile' }
  }
}

export function conCookie(risposta: NextResponse, cookie: CookieDaScrivere[]): NextResponse {
  for (const c of cookie) risposta.cookies.set(c.name, c.value, c.options)
  return risposta
}

// Il nome con cui la pagina di conferma presenta chi e' dentro: il conto per un cliente, nome e cognome per lo
// staff, l'email se non c'e' altro. La pagina la vede solo il browser con quella sessione: e' il suo nome.
async function nomeDiChiEDentro(admin: any, u: { utenteId: string; email: string }): Promise<string> {
  try {
    const { data: r } = await admin.from('utenti').select('cliente_id,nome,cognome').eq('id', u.utenteId).maybeSingle()
    if (r?.cliente_id) {
      const { data: c } = await admin.from('clienti').select('ragione_sociale,codice_cliente').eq('id', r.cliente_id).maybeSingle()
      const conto = String(c?.ragione_sociale || '').trim()
      const codice = String(c?.codice_cliente || '').trim()
      if (conto) return codice ? `${conto} (${codice})` : conto
    }
    const persona = [r?.nome, r?.cognome].map((x) => String(x || '').trim()).filter(Boolean).join(' ')
    if (persona) return persona
  } catch {}
  return u.email
}

// IL GETTONE DELLA CONFERMA D'INGRESSO (app/api/integrazioni/shopify/entra).
//
// Firmato con SHOPIFY_API_SECRET per QUEL negozio, QUEL conto di destinazione e QUELL'utente della sessione che
// si lascia, e vale cinque minuti. L'utente conta quanto il resto: un browser senza Sec-Fetch-Site (Safari
// prima della 16.4) non dice da quale sito parte un modulo, e i cookie di sessione (SameSite=Lax) non partono
// con un modulo inviato da un altro sito. Un modulo falso arriverebbe quindi «senza sessione», e un ingresso
// automatico fatto li' scriverebbe la sessione del negozio sopra quella che il browser ha: proprio la
// sostituzione che la conferma deve impedire. Per questo la conferma vale solo con la sessione di chi l'ha vista.
// Il prefisso separa questa firma da quelle dei moduli della scelta, che usano lo stesso segreto.
// Un minuto di tolleranza sulla scadenza nel futuro, come il gettone di Amazon (lib/amazon-pagina.ts): pagina e
// conferma possono girare su due istanze coi loro orologi.
const DURATA_CONFERMA_MS = 5 * 60 * 1000
const TOLLERANZA_OROLOGI_MS = 60 * 1000

function firmaConferma(o: { shop: string; clienteId: string; utenteId: string }, scade: number): string {
  const segreto = process.env.SHOPIFY_API_SECRET || ''
  if (!segreto) return ''
  return crypto.createHmac('sha256', segreto)
    .update(['shopify-entra', o.shop, o.clienteId, o.utenteId, String(scade)].join('|')).digest('hex')
}

// '' se manca il segreto: allora non si conferma niente.
export function gettoneConfermaIngresso(o: { shop: string; clienteId: string; utenteId: string }, ora = Date.now()): string {
  const scade = ora + DURATA_CONFERMA_MS
  const firma = firmaConferma(o, scade)
  return firma ? `${scade}.${firma}` : ''
}

export function confermaIngressoValida(gettone: string, o: { shop: string; clienteId: string; utenteId: string }, ora = Date.now()): boolean {
  const m = /^(\d{13})\.([0-9a-f]{64})$/.exec(String(gettone || ''))
  if (!m) return false
  const scade = Number(m[1])
  if (!(scade > ora) || scade - ora > DURATA_CONFERMA_MS + TOLLERANZA_OROLOGI_MS) return false
  const atteso = firmaConferma(o, scade)
  if (!atteso) return false
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(atteso, 'hex'))
}

// ENTRARE NEL PORTALE APRENDO L'APP DA SHOPIFY.
//
// Decisione di Lorenzo del 21/10/2026: entra da solo, con l'accesso automatico, SOLO il conto nato
// dall'installazione. Il suo negoziante non ha mai scelto ne' email ne' password, e questa e' la sua porta. Un
// conto che esisteva gia' e ha collegato il negozio con «Ho già un account» e' un conto vero, col credito, gli
// ordini di tutti i canali e le impostazioni: aprirlo a chi apre l'app dall'admin del negozio vorrebbe dire
// darlo a chiunque abbia accesso alle app di quel negozio Shopify, staff compreso. Lui entra solo se nel
// browser c'e' gia' la sessione di quel cliente; altrimenti va al modulo di accesso, col motivo
// (accedi_per_continuare).
//
// ...E SOLO DAL SUO NEGOZIO. Il conto nato dall'installazione e' quello con l'indirizzo costruito per QUESTO
// negozio (emailContoShopify). Fino al 21/10/2026 bastava un indirizzo del dominio dei conti Shopify
// (contoNatoDaShopify): collegato un secondo negozio a quel conto («Collega al conto …» nella pagina della
// scelta), chiunque nello staff del secondo negozio sarebbe entrato senza password nel conto del primo. Dagli
// altri negozi collegati vale la regola del conto vero; e siccome quel conto una password non ce l'ha, il
// messaggio dice di aprire l'app dal negozio da cui e' nato (apri_dal_negozio_del_conto).
//
// ...E SENZA CACCIARE IN SILENZIO CHI E' GIA' DENTRO. L'accesso automatico sostituisce la sessione del browser
// (lib/shopifyLogin.ts cancella i cookie sb-* di prima). Fino al 21/10/2026 lo faceva sempre: chi ha un conto
// nato da Shopify poteva mandare a un cliente il link fresco del proprio negozio e farlo lavorare nel proprio
// conto senza che se ne accorgesse (ricariche comprese). Decisione di Lorenzo del 21/10/2026: se nel browser
// c'e' la sessione valida di un'ALTRA persona (un utente diverso da quello del conto del negozio, qualunque
// ruolo), prima si chiede conferma con una pagina; il pulsante passa da app/api/integrazioni/shopify/entra, col
// gettone qui sopra. Senza sessione, o con quella dello stesso utente, si entra da soli come prima.
//
// `shop`: il negozio da cui si apre l'app. `status`: 307 dopo una GET (ingresso, ritorno dall'OAuth), 303 dopo un
// POST (lib/shopifyLogin.ts). `ripiego`: cosa fare quando il conto non si apre per una causa che una nuova
// autorizzazione ripara: il conto nato da Shopify rimasto senza accesso (lo ricrea l'installazione,
// lib/shopifyProvision.ts) o la riga del negozio che punta a un cliente che non c'e' piu' (l'installazione lo
// tratta da negozio nuovo). /enter ci passa l'avvio dell'OAuth; senza ripiego si mostra l'errore.
// `confermatoDa`: la sessione che ha appena confermato (solo da app/api/integrazioni/shopify/entra, che ha gia'
// verificato il gettone per lei): con questa la conferma non si chiede di nuovo.
export async function entraNelPortaleDaShopify(
  req: NextRequest,
  admin: any,
  opz: {
    clienteId: string
    shop: string
    status?: StatoRedirect
    ripiego?: () => Promise<NextResponse>
    confermatoDa?: Extract<UtenteDelBrowser, { stato: 'utente' }>
  },
): Promise<NextResponse> {
  const status = opz.status ?? 307
  const vai = (percorso: string) => NextResponse.redirect(new URL(percorso, req.url), status)

  const { data: cliente, error } = await admin.from('clienti').select('email').eq('id', opz.clienteId).maybeSingle()
  // Una lettura fallita non dice se il conto e' nato da Shopify: niente accesso automatico al buio, si
  // riprova riaprendo.
  if (error) {
    console.error('[SHOPIFY][INGRESSO] lettura del cliente', opz.clienteId, error.message)
    return vai(conErrore('/cliente', 'ingresso_non_riuscito'))
  }
  if (!cliente) {
    console.error('[SHOPIFY][INGRESSO] il negozio punta a un cliente che non esiste piu', opz.clienteId)
    return opz.ripiego ? opz.ripiego() : vai(conErrore('/cliente', 'ingresso_non_riuscito'))
  }

  const natoDaQuestoNegozio = !!opz.shop && String(cliente.email || '').trim().toLowerCase() === emailContoShopify(opz.shop)
  if (natoDaQuestoNegozio) {
    const accesso = await leggiAccessoDelCliente(admin, opz.clienteId)
    if (accesso.esito === 'presente') {
      const dentro = opz.confermatoDa ?? await utenteDelBrowser(req)
      if (dentro.stato === 'illeggibile') return vai(conErrore('/cliente', 'ingresso_non_riuscito'))
      if (dentro.stato === 'utente' && dentro.utenteId !== accesso.utenteId && !opz.confermatoDa) {
        const gettone = gettoneConfermaIngresso({ shop: opz.shop, clienteId: String(opz.clienteId), utenteId: dentro.utenteId })
        if (!gettone) {
          console.error('[SHOPIFY][INGRESSO] SHOPIFY_API_SECRET assente: conferma non firmabile', opz.shop)
          return vai(conErrore('/cliente', 'shopify_non_configurato'))
        }
        console.warn('[SHOPIFY][INGRESSO] nel browser c\'e\' un altro utente: si chiede conferma prima di entrare', opz.shop, dentro.utenteId)
        // La sessione resta quella di prima: se la verifica l'ha rinnovata, i cookie nuovi vanno con la pagina.
        return conCookie(paginaConfermaIngresso({ shop: opz.shop, nome: await nomeDiChiEDentro(admin, dentro), gettone }), dentro.cookie)
      }
      return loginMerchantERedirect(req, accesso.email, '/cliente/dashboard', status)
    }
    // Un accesso illeggibile non e' un accesso che manca. Rifare l'autorizzazione per «ripararlo» ritirerebbe
    // per niente il token buono del negozio: lo scambio del codice ritira subito ogni altro refresh token
    // dell'app su quel negozio (guida Shopify, access tokens).
    if (accesso.esito === 'illeggibile') {
      console.error('[SHOPIFY][INGRESSO] accesso del conto illeggibile', opz.clienteId, accesso.motivo)
      return vai(conErrore('/cliente', 'ingresso_non_riuscito'))
    }
    console.error('[SHOPIFY][INGRESSO] conto nato da Shopify senza accesso', opz.clienteId, accesso.anomalia || '')
    return opz.ripiego ? opz.ripiego() : vai(conErrore('/cliente', 'login_shopify'))
  }

  const dentro = await clienteDellaSessione(admin)
  if (dentro && dentro.clienteId === String(opz.clienteId)) return vai('/cliente/dashboard')
  // Il conto nato dall'installazione di un ALTRO negozio non ha una password da mettere: si entra aprendo
  // l'app da quel negozio.
  return vai(conErrore('/cliente', contoNatoDaShopify(cliente) ? 'apri_dal_negozio_del_conto' : 'accedi_per_continuare'))
}
