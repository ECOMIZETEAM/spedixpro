import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { provisionShopifyCliente } from '@/lib/shopifyProvision'
import { SHOPIFY_SCOPES_ESSENZIALI } from '@/lib/shopify'
import { loginMerchantERedirect } from '@/lib/shopifyLogin'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

// Verifica firma HMAC della richiesta Shopify (valori decodificati, key=value ordinati, join &)
function verifyHmac(sp: URLSearchParams, secret: string): boolean {
  const hmac = sp.get('hmac') || ''
  const entries: string[] = []
  sp.forEach((v, k) => { if (k !== 'hmac' && k !== 'signature') entries.push(`${k}=${v}`) })
  entries.sort()
  const message = entries.join('&')
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = url.searchParams
  const shop = (sp.get('shop') || '').toLowerCase()
  const code = sp.get('code') || ''
  const state = sp.get('state') || ''

  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'Configurazione Shopify mancante (variabili ambiente)' }, { status: 500 })
  }
  if (!SHOP_RE.test(shop) || !code || !state) {
    return NextResponse.json({ error: 'Callback Shopify non valido' }, { status: 400 })
  }
  if (!verifyHmac(sp, apiSecret)) {
    return NextResponse.json({ error: 'Verifica HMAC fallita' }, { status: 400 })
  }

  // shopify_oauth_state è chiusa (RLS + no grant anon/authenticated) e al ritorno cross-site dall'OAuth
  // il cookie di sessione può mancare: leggo/consumo lo state col client admin (service_role).
  const adminState = createAdminSupabase()

  // Valida e consuma lo state
  const { data: st } = await adminState
    .from('shopify_oauth_state').select('*').eq('state', state).maybeSingle()
  if (!st || st.shop !== shop) {
    // State gia' consumato (reload/back/retry del callback) o scaduto. IDEMPOTENZA: se il negozio
    // RISULTA GIA' COLLEGATO, il primo giro e' andato a buon fine -> trattiamo il reload come successo,
    // invece del vecchio JSON "400 State non valido" che sembra "l'app non funziona". Altrimenti si
    // manda a una pagina utile per riprovare, non a un errore grezzo.
    const { data: gia } = await adminState.from('integrazioni').select('id')
      .eq('piattaforma', 'shopify').eq('identificativo', shop).eq('stato', 'attivo').maybeSingle()
    if (gia?.id) return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=${encodeURIComponent(shop)}`)
    return NextResponse.redirect(new URL('/cliente?error=collegamento_scaduto', req.url))
  }
  await adminState.from('shopify_oauth_state').delete().eq('state', state)

  // Scambia code -> access token OFFLINE A SCADENZA (`expiring=1`). Shopify NON accetta piu' i
  // token offline non-scadenti sull'Admin API (risponde 403 "Non-expiring access tokens are no
  // longer accepted"). Con `expiring=1` la risposta porta access_token + expires_in + refresh_token:
  // il token si rinnova col refresh (vedi getValidShopifyToken), non si "rompe". Al refresh Shopify
  // INVALIDA il vecchio refresh_token, quindi va sempre salvato quello nuovo.
  let token = ''
  let scope = ''
  let refreshToken = ''
  let expiresAt: number | null = null
  let refreshExpiresAt: number | null = null
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code, expiring: '1' }),
    })
    const raw = await r.text()
    let d: any = null
    try { d = JSON.parse(raw) } catch {}
    if (!r.ok || !d) throw new Error(`HTTP ${r.status} — risposta non valida da Shopify`)
    token = d.access_token
    scope = d.scope || ''
    refreshToken = d.refresh_token || ''
    const now = Date.now()
    if (d.expires_in) expiresAt = now + Number(d.expires_in) * 1000
    if (d.refresh_token_expires_in) refreshExpiresAt = now + Number(d.refresh_token_expires_in) * 1000
    if (!token) throw new Error('nessun access_token ricevuto')
  } catch (e: any) {
    console.error('[SHOPIFY][CALLBACK] scambio token', shop, e?.message || e)
    // Non un 502 JSON grezzo (sembra "l'app non funziona"): pagina utile per riprovare.
    return NextResponse.redirect(new URL('/cliente?error=collegamento_token', req.url))
  }

  // COSA HA CONCESSO DAVVERO IL NEGOZIANTE.
  //
  // Shopify torna qui l'elenco degli scope concessi, e finora lo salvavamo senza guardarlo. Ma il
  // negoziante puo' concederne meno di quelli chiesti, e la doc lo dice esplicitamente ("Merchants
  // can modify requested scopes during authorization, so always verify before storing the token").
  // Un negozio salvato 'attivo' con un token che non vede i fulfillment order e' un negozio dove
  // ogni evasione muore in silenzio: da fuori sembra collegato, e gli ordini restano Unfulfilled
  // per sempre. Meglio dirlo subito e far rifare il collegamento.
  // Si guardano i write_*, non i read_*: un write include gia' il suo read e nella lista dei
  // concessi torna il write.
  const concessi = String(scope || '').split(',').map((x) => x.trim())
  const mancanti = SHOPIFY_SCOPES_ESSENZIALI.filter((x) => !concessi.includes(x))
  if (mancanti.length) {
    console.error('[SHOPIFY][CALLBACK] scope insufficienti', shop, scope)
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('Il negozio non ha concesso tutti i permessi necessari (' + mancanti.join(', ') + '). Rifai il collegamento accettando tutte le autorizzazioni.')}`)
  }

  // Da qui in poi si scrive col client ADMIN, non con la sessione del browser.
  //
  // L'autorizzazione a scrivere questa riga NON viene dai cookie: viene dallo `state` firmato che
  // abbiamo appena validato e consumato. Passare dal client utente significava dipendere da un
  // cookie che al ritorno cross-site da Shopify puo' benissimo non esserci (e' scritto qui sopra,
  // ed e' il motivo per cui lo state si legge con l'admin): la RLS rifiutava la scrittura, l'errore
  // non lo guardava nessuno e il negoziante veniva rimandato su "?connected=" senza integrazione.
  const admin = createAdminSupabase()

  // CASO A: cliente gia' identificato -> integrazione attiva
  if (st.cliente_id) {
  const payload: any = {
    master_id: st.master_id,
    cliente_id: st.cliente_id,
    piattaforma: 'shopify',
    nome_negozio: shop,
    identificativo: shop,
    credenziali: { access_token: token, scope, shop, refresh_token: refreshToken, expires_at: expiresAt, refresh_expires_at: refreshExpiresAt },
    stato: 'attivo',
    errore: null,
  }

  // UN NEGOZIO APPARTIENE A UN CLIENTE SOLO.
  //
  // Prima la riga esistente si cercava per (cliente_id + piattaforma + identificativo): bastava che
  // a fare l'OAuth fosse una sessione di un ALTRO cliente perche' non la trovasse e ne inserisse una
  // seconda per lo stesso negozio. Non esiste alcun vincolo di unicita' che lo impedisca (verificato
  // su pg_constraint: su `integrazioni` c'e' solo la chiave primaria), quindi lo stesso shop
  // finiva collegato a due clienti e da li' in poi ordini e token andavano al posto sbagliato.
  // Si cerca per NEGOZIO e si aggiorna quella riga: la reinstallazione riaggancia, non duplica.
  // Lo stesso vale per l'admin del CASO B piu' sotto, che gia' faceva cosi'.
  const { data: existing } = await admin
    .from('integrazioni').select('id,cliente_id')
    .eq('piattaforma', 'shopify')
    .eq('identificativo', shop)
    .maybeSingle()

  // ...E UN NEGOZIO GIA' DI QUALCUN ALTRO NON SI PORTA VIA.
  //
  // Chi apre l'app dallo store finisce su /install, che prende il cliente dalla sessione presente
  // nel browser: se in quel browser e' loggato un ALTRO cliente MoovExpress, senza questo controllo
  // il negozio gli veniva riassegnato — con gli ordini del negoziante (nome, indirizzo, telefono
  // del compratore) che finivano nel portale di un terzo. Il riaggancio allo STESSO cliente resta
  // libero: e' la reinstallazione, e deve funzionare.
  if (existing?.cliente_id && existing.cliente_id !== st.cliente_id) {
    console.error('[SHOPIFY][CALLBACK] negozio gia collegato ad altro cliente', shop)
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('Questo negozio risulta gia collegato a un altro account. Scollegalo da li, poi riprova.')}`)
  }

  // L'esito si guarda: al ritorno cross-site dall'OAuth il cookie di sessione puo' mancare (vedi il
  // commento sullo state qui sopra) e la RLS farebbe fallire la scrittura in SILENZIO — merchant
  // rimandato su "?connected=" con un'integrazione senza token.
  const esito = existing?.id
    ? await admin.from('integrazioni').update(payload).eq('id', existing.id)
    : await admin.from('integrazioni').insert(payload)
  if ((esito as any)?.error) {
    console.error('[SHOPIFY][CALLBACK] integrazione non salvata', shop, (esito as any).error.message)
    return NextResponse.redirect(`${appUrl}/cliente/integrazioni?error=${encodeURIComponent('Collegamento non salvato, riprova dalle Integrazioni')}`)
  }

  return NextResponse.redirect(`${appUrl}/cliente/integrazioni?connected=${encodeURIComponent(shop)}`)
  }

  // CASO B: install dallo store senza cliente identificato -> AUTO-CREAZIONE.
  // Creo (o riuso) un cliente MoovExpress sotto il master di onboarding (default root),
  // collego il negozio e porto il merchant nel portale GIÀ LOGGATO (modello redirect).
  const prov = await provisionShopifyCliente(admin, shop, token)
  if ('error' in prov) {
    return NextResponse.redirect(`${appUrl}/cliente?error=${encodeURIComponent(prov.error)}`)
  }
  const payload: any = {
    master_id: prov.masterId, cliente_id: prov.clienteId, piattaforma: 'shopify',
    nome_negozio: shop, identificativo: shop,
    credenziali: { access_token: token, scope, shop, refresh_token: refreshToken, expires_at: expiresAt, refresh_expires_at: refreshExpiresAt },
    stato: 'attivo', errore: null,
  }
  const { data: existing } = await admin.from('integrazioni').select('id')
    .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  const esitoB = existing?.id
    ? await admin.from('integrazioni').update(payload).eq('id', existing.id)
    : await admin.from('integrazioni').insert(payload)
  if ((esitoB as any)?.error) {
    console.error('[SHOPIFY][CALLBACK] integrazione non salvata (auto-creazione)', shop, (esitoB as any).error.message)
    return NextResponse.redirect(`${appUrl}/cliente?error=${encodeURIComponent('Collegamento non salvato, riprova')}`)
  }

  // login automatico nel portale MoovExpress
  return loginMerchantERedirect(req, prov.email, '/cliente/dashboard')
}
