import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { amazonCallbackAppstore, amazonConfigurato, richiestaDalPortale } from '@/lib/amazon'
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
// quale account MoovExpress si sta collegando Amazon e chiede conferma. Solo la conferma (POST dal
// portale stesso) crea lo `state` e rimanda ad Amazon, che chiude il giro sul callback.

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

async function clienteLoggato() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) return null
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', utente.cliente_id).maybeSingle()
  return { ...utente, ragione_sociale: cliente?.ragione_sociale || '' }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const callbackAmazon = url.searchParams.get('amazon_callback_uri') || ''
  const statoAmazon = url.searchParams.get('amazon_state') || ''
  const versione = url.searchParams.get('version') || ''
  const sellerId = url.searchParams.get('selling_partner_id') || ''
  // Si controlla subito che il ritorno porti davvero ad Amazon: una pagina di conferma per un
  // indirizzo che poi non accetteremmo non serve a nessuno.
  if (!callbackAmazon || !statoAmazon || !amazonConfigurato() || !amazonCallbackAppstore(callbackAmazon, statoAmazon, 'x', null)) {
    return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+valido', req.url))
  }
  // Senza sessione non sappiamo a quale cliente collegare l'account: si accede e si collega dalla
  // pagina Integrazioni (stesso risultato, partendo dal portale).
  const cli = await clienteLoggato()
  if (!cli) return NextResponse.redirect(new URL('/cliente?error=amazon_accedi', req.url))

  const nascosto = (n: string, v: string) => `<input type="hidden" name="${n}" value="${esc(v)}">`
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Collegare Amazon · MoovExpress</title>
<style>body{margin:0;background:#f7f7f8;font-family:Inter,-apple-system,sans-serif;color:#1f2937}
.box{max-width:440px;margin:60px auto;padding:28px;background:#fff;border:1px solid #e8e8e8;border-radius:10px}
h1{font-size:19px;margin:0 0 14px}p{font-size:14.5px;line-height:1.55;margin:0 0 12px}
.acc{font-weight:700}button{margin-top:10px;width:100%;padding:12px;border:0;border-radius:8px;background:#f97316;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
a{display:block;text-align:center;margin-top:14px;font-size:13.5px;color:#6b7280}</style></head><body><div class="box">
<h1>Collegare Amazon a MoovExpress</h1>
<p>Stai collegando l'account venditore Amazon${sellerId ? ` <span class="acc">${esc(sellerId)}</span>` : ''} all'account MoovExpress <span class="acc">${esc(cli.ragione_sociale || 'del tuo portale')}</span>.</p>
<p>Gli ordini Amazon da spedire arriveranno in questo portale, e il tracking tornerà su Amazon a spedizione fatta.</p>
<form method="post">${nascosto('amazon_callback_uri', callbackAmazon)}${nascosto('amazon_state', statoAmazon)}${nascosto('version', versione)}
<button type="submit">Conferma e continua su Amazon</button></form>
<a href="/cliente/integrazioni">Non è il mio account: annulla</a>
</div></body></html>`
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  // La conferma deve venire dalla pagina qui sopra, servita dal nostro dominio.
  if (!richiestaDalPortale(req)) return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+valido', req.url), 303)
  const form = await req.formData().catch(() => null)
  const callbackAmazon = String(form?.get('amazon_callback_uri') || '')
  const statoAmazon = String(form?.get('amazon_state') || '')
  const versione = String(form?.get('version') || '') || null
  if (!callbackAmazon || !statoAmazon || !amazonConfigurato()) {
    return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+valido', req.url), 303)
  }
  const cli = await clienteLoggato()
  if (!cli) return NextResponse.redirect(new URL('/cliente?error=amazon_accedi', req.url), 303)

  const state = crypto.randomBytes(24).toString('hex')
  const ritorno = amazonCallbackAppstore(callbackAmazon, statoAmazon, state, versione)
  if (!ritorno) return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+valido', req.url), 303)
  const { error } = await createAdminSupabase().from('shopify_oauth_state').insert({ state, cliente_id: cli.cliente_id, master_id: cli.master_id, shop: 'amazon' })
  if (error) return NextResponse.redirect(new URL('/cliente/integrazioni?error=collegamento+Amazon+non+avviato', req.url), 303)
  return NextResponse.redirect(ritorno, 303)
}
