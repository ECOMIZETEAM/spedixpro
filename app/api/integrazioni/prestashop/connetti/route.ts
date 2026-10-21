import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { psPermessiMancanti } from '@/lib/prestashop'
import { COME_SI_COLLEGA_SHOPIFY } from '@/lib/shopify-scheda-app'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono connettere integrazioni' }, { status: 403 })
  }
  const body = await req.json()
  const nome = (body.nome_negozio || '').trim()
  let url = (body.url || '').trim().replace(/\/+$/, '')
  const key = (body.webservice_key || '').trim()
  if (!url || !key) return NextResponse.json({ error: 'URL e Webservice Key obbligatori' }, { status: 400 })
  if (!/^https?:\/\//.test(url)) url = 'https://' + url

  let avviso: string | null = null
  try {
    const auth = Buffer.from(key + ':').toString('base64')
    // Doppia auth: header Basic + ws_key in query (molti hosting strippano l'header Authorization).
    const test = await fetch(url + '/api/?ws_key=' + encodeURIComponent(key), { headers: { 'Authorization': 'Basic ' + auth }, signal: AbortSignal.timeout(10000) })
    const txt = await test.text().catch(() => '')
    if (test.status === 401) return NextResponse.json({ error: 'PrestaShop rifiuta la chiave (401). Nel back office verifica: 1) Parametri avanzati → Webservice → "Abilita il webservice di PrestaShop" = SÌ; 2) che la chiave sia copiata esatta (32 caratteri, senza spazi); 3) che la chiave sia ABILITATA e abbia i permessi (Visualizza/GET su orders, addresses, customers, states, countries, order_states, order_carriers; Modifica/PUT su order_carriers; Aggiungi/POST su order_histories).' }, { status: 400 })
    if (!test.ok) return NextResponse.json({ error: 'PrestaShop ha risposto con codice ' + test.status + '. Verifica che l\'URL sia quello esatto del negozio (con o senza www, https) e che il Webservice sia attivo.' }, { status: 400 })
    // LA RISPOSTA NON È PRESTASHOP. Il Webservice PrestaShop risponde con XML radice <prestashop>. Se il
    // sito e' su un'altra piattaforma puo' rispondere 200 con una pagina HTML: prima si salvava
    // un'integrazione che poi non sincronizzava nulla. Ora riconosciamo la piattaforma vera e lo spieghiamo
    // (come per WooCommerce/connetti). Una PrestaShop reale contiene sempre "prestashop" nella risposta.
    if (!/prestashop/i.test(txt)) {
      if (/storeden/i.test(txt)) return NextResponse.json({ error: 'Questo sito è realizzato con Storeden, non con PrestaShop: non ha il Webservice PrestaShop da collegare. Le integrazioni supportano WooCommerce, Shopify e PrestaShop.' }, { status: 400 })
      // Shopify non si collega scrivendo il sito (requisito 2.3.1): la frase sta con la scheda dell'app.
      if (/cdn\.shopify|myshopify|x-shopify/i.test(txt)) return NextResponse.json({ error: 'Questo sito sembra Shopify, non PrestaShop: ' + COME_SI_COLLEGA_SHOPIFY }, { status: 400 })
      if (/wp-content|wp-json|woocommerce/i.test(txt)) return NextResponse.json({ error: 'Questo sito sembra WordPress/WooCommerce, non PrestaShop: collegalo dalla sezione WooCommerce.' }, { status: 400 })
      if (/<!doctype|<html[\s>]/i.test(txt)) return NextResponse.json({ error: 'Questo indirizzo non espone il Webservice PrestaShop (risponde con una pagina web, non con i dati XML). Controlla che sia davvero un sito PrestaShop e che il Webservice sia attivo su /api.' }, { status: 400 })
      return NextResponse.json({ error: 'La risposta non sembra quella di un Webservice PrestaShop. Verifica che l\'URL sia quello del negozio e che il Webservice sia attivo su /api.' }, { status: 400 })
    }
    // I PERMESSI SI CONTROLLANO ADESSO, col negoziante davanti alla schermata della chiave. Prima
    // bastava che la chiave rispondesse: due negozi si sono collegati senza `states` e `countries` e
    // per mesi hanno ricevuto ordini con la provincia vuota e il paese sempre "Italia" (anche quelli
    // per l'estero), altri due senza permessi di scrittura e il tracking non e' mai tornato sul
    // negozio — e niente lo diceva. Senza lettura degli indirizzi non si collega; senza scrittura si
    // collega, ma lo si avvisa.
    const permessi = psPermessiMancanti(txt)
    if (permessi?.bloccanti.length) {
      return NextResponse.json({ error: 'Alla chiave Webservice mancano dei permessi, senza i quali gli ordini arriverebbero incompleti: ' + permessi.bloccanti.join(', ') + '. In PrestaShop apri Parametri Avanzati → Webservice → la tua chiave, spunta quelle caselle, salva e riprova. Per far tornare anche il tracking sul negozio spunta inoltre: order_carriers → Modifica (PUT) e order_histories → Aggiungi (POST).' }, { status: 400 })
    }
    if (permessi?.avvisi.length) {
      avviso = 'Alla chiave Webservice mancano questi permessi: ' + permessi.avvisi.join(', ') + '. Gli ordini arrivano lo stesso, ma finché non li abiliti il numero di tracking non torna sul negozio e gli ordini già spediti dal negozio possono non essere riconosciuti. Si abilitano in PrestaShop: Parametri Avanzati → Webservice → la tua chiave.'
    }
  } catch {
    return NextResponse.json({ error: 'Impossibile raggiungere il sito PrestaShop. Verifica URL.' }, { status: 400 })
  }

  const payload: any = {
    master_id: utente.master_id,
    cliente_id: utente.cliente_id,
    piattaforma: 'prestashop',
    nome_negozio: nome || url,
    identificativo: url,
    credenziali: { url, key },
    stato: 'attivo',
    errore: null,
  }
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', utente.cliente_id).eq('piattaforma', 'prestashop').eq('identificativo', url).maybeSingle()
  // L'esito della scrittura si guarda: prima si rispondeva "collegato" anche se il salvataggio falliva.
  const { error: errSalva } = existing?.id
    ? await supabase.from('integrazioni').update(payload).eq('id', existing.id)
    : await supabase.from('integrazioni').insert(payload)
  if (errSalva) return NextResponse.json({ error: 'Il negozio risponde, ma non è stato possibile salvare il collegamento. Riprova tra poco.' }, { status: 500 })
  return NextResponse.json({ ok: true, avviso })
}
