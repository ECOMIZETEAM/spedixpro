import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonCallbackAppstore, amazonConfigurato } from '@/lib/amazon'
import { esc, paginaAmazon, gettoneModulo, gettoneValido } from '@/lib/amazon-pagina'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "OAuth Login URI" dell'app Amazon: la pagina che Amazon apre quando il venditore autorizza
// partendo dall'APPSTORE (o rinnova l'autorizzazione). Amazon passa `amazon_callback_uri` e
// `amazon_state` (piu' `version=beta` finche' l'app e' in bozza).
//
// DUE PASSI. L'apertura (GET) arriva da Amazon, cioe' da un altro sito: chiunque potrebbe
// costruire quel link, e se il browser di chi lo apre fosse entrato nel portale di un ALTRO
// (vedi la rotta install) il collegamento finirebbe li'. Quindi il GET non crea niente: mostra a
// quale account MoovExpress si sta collegando Amazon e chiede conferma. Solo la conferma (POST col
// gettone di questa pagina, lib/amazon-pagina) crea lo `state` e rimanda ad Amazon, che chiude il
// giro sul callback.

const torna = (req: NextRequest, codice: string) => NextResponse.redirect(new URL(`/cliente/integrazioni?amazon=${codice}`, req.url), 303)

async function chiEntra() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null as any, cli: null as any }
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id, masters(demo)').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) return { user, cli: null as any }
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', utente.cliente_id).maybeSingle()
  const m: any = Array.isArray((utente as any).masters) ? (utente as any).masters[0] : (utente as any).masters
  return { user, cli: { cliente_id: utente.cliente_id, master_id: utente.master_id, ragione_sociale: cliente?.ragione_sociale || '', demo: m?.demo === true } }
}

// Chi ha una sessione ma non e' un cliente (o e' in prova) non finisce sulla pagina di login, che
// lo rimanderebbe alla sua dashboard senza dire niente: gli si spiega qui.
const nonCliente = () => paginaAmazon('Serve l\'account del negozio', '<p>Amazon si collega a un account <span class="acc">cliente</span> di MoovExpress, quello con cui il negozio spedisce. Esci, accedi con quell\'account e riprova da Amazon, oppure collega da Integrazioni → Amazon.</p><a href="/cliente">Vai all\'accesso clienti</a>', 403)
const inProva = () => paginaAmazon('Non disponibile in prova', '<p>Nella prova dimostrativa non si collegano account reali. Il collegamento con Amazon sarà disponibile con l\'account attivo.</p><a href="/cliente/integrazioni">Torna alle integrazioni</a>', 403)

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const callbackAmazon = url.searchParams.get('amazon_callback_uri') || ''
  const statoAmazon = url.searchParams.get('amazon_state') || ''
  const versione = url.searchParams.get('version') || ''
  // Il codice venditore arriva dal link: si mostra solo se ha la forma di un codice Amazon, per non
  // far scrivere a chiunque una frase a piacere su una nostra pagina. Il conto vero lo decide Amazon.
  const sellerGrezzo = url.searchParams.get('selling_partner_id') || ''
  const sellerId = /^[A-Z0-9]{8,20}$/.test(sellerGrezzo) ? sellerGrezzo : ''
  // Si controlla subito che il ritorno porti davvero ad Amazon: una pagina di conferma per un
  // indirizzo che poi non accetteremmo non serve a nessuno.
  if (!callbackAmazon || !statoAmazon || !amazonConfigurato() || !amazonCallbackAppstore(callbackAmazon, statoAmazon, 'x', null)) {
    return torna(req, 'non_valido')
  }
  const { user, cli } = await chiEntra()
  // Senza sessione non sappiamo a quale cliente collegare l'account: si accede e si collega dalla
  // pagina Integrazioni (stesso risultato, partendo dal portale).
  if (!user) return NextResponse.redirect(new URL('/cliente?error=amazon_accedi', req.url))
  if (!cli) return nonCliente()
  if (cli.demo) return inProva()

  const nascosto = (n: string, v: string) => `<input type="hidden" name="${n}" value="${esc(v)}">`
  return paginaAmazon('Collegare Amazon a MoovExpress', `
<p>Stai collegando l'account venditore Amazon${sellerId ? ` <span class="acc">${esc(sellerId)}</span>` : ''} all'account MoovExpress <span class="acc">${esc(cli.ragione_sociale || 'del tuo portale')}</span>.</p>
<p>Gli ordini Amazon da spedire arriveranno in questo portale, e il tracking tornerà su Amazon a spedizione fatta.</p>
<form method="post">${nascosto('amazon_callback_uri', callbackAmazon)}${nascosto('amazon_state', statoAmazon)}${nascosto('version', versione)}${nascosto('gettone', gettoneModulo(user.id, statoAmazon))}
<button type="submit">Conferma e continua su Amazon</button></form>
<a href="/cliente/integrazioni">Non è il mio account: annulla</a>`)
}

export async function POST(req: NextRequest) {
  // La conferma deve venire dalla pagina qui sopra. Un browser che lo dice (Sec-Fetch-Site) deve
  // dire "stesso sito"; in ogni caso decide il gettone, che solo quella pagina, servita a questo
  // utente, puo' avere.
  const sito = req.headers.get('sec-fetch-site')
  if (sito && sito !== 'same-origin') return torna(req, 'non_valido')
  const form = await req.formData().catch(() => null)
  const callbackAmazon = String(form?.get('amazon_callback_uri') || '')
  const statoAmazon = String(form?.get('amazon_state') || '')
  const versione = String(form?.get('version') || '') || null
  const gettone = String(form?.get('gettone') || '')
  if (!callbackAmazon || !statoAmazon || !amazonConfigurato()) return torna(req, 'non_valido')
  const { user, cli } = await chiEntra()
  if (!user) return NextResponse.redirect(new URL('/cliente?error=amazon_accedi', req.url), 303)
  if (!cli) return nonCliente()
  if (cli.demo) return inProva()
  if (!gettoneValido(gettone, user.id, statoAmazon)) return torna(req, 'scaduto')

  const state = crypto.randomBytes(24).toString('hex')
  const ritorno = amazonCallbackAppstore(callbackAmazon, statoAmazon, state, versione)
  if (!ritorno) return torna(req, 'non_valido')
  const { error } = await createAdminSupabase().from('shopify_oauth_state').insert({ state, cliente_id: cli.cliente_id, master_id: cli.master_id, shop: 'amazon' })
  if (error) return torna(req, 'non_avviato')
  return NextResponse.redirect(ritorno, 303)
}
