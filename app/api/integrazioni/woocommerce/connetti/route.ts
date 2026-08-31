import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { wooGet } from '@/lib/woo'

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
  const ck = (body.consumer_key || '').trim()
  const cs = (body.consumer_secret || '').trim()
  if (!url || !ck || !cs) return NextResponse.json({ error: 'URL, Consumer Key e Consumer Secret obbligatori' }, { status: 400 })
  if (!/^https?:\/\//.test(url)) url = 'https://' + url

  // test connessione
  try {
    await wooGet(url, ck, cs, '/orders?per_page=1')
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (msg.includes('401') || msg.includes('403')) return NextResponse.json({ error: 'Chiavi API non valide (accesso negato). Verifica Consumer Key/Secret e i permessi (lettura/scrittura).' }, { status: 400 })
    // IL SITO NON È WOOCOMMERCE. L'API risponde con una PAGINA HTML (404/home) invece del JSON: succede
    // quando il negozio è su un'altra piattaforma. Il 404 grezzo ("<!DOCTYPE html>...") non dice niente
    // al cliente — qui riconosciamo la piattaforma vera e lo spieghiamo. (Caso reale: ilpapiroshop.com
    // è Storeden, non WooCommerce — l'errore mostrava l'HTML di una pagina "storeden-404.html".)
    if (/storeden/i.test(msg)) return NextResponse.json({ error: 'Questo sito è realizzato con Storeden, non con WooCommerce: non ha le API WooCommerce da collegare. Le integrazioni supportano WooCommerce, Shopify e PrestaShop.' }, { status: 400 })
    if (/cdn\.shopify|myshopify|x-shopify/i.test(msg)) return NextResponse.json({ error: 'Questo sito sembra Shopify, non WooCommerce: collegalo dalla sezione Shopify, non da WooCommerce.' }, { status: 400 })
    if (/prestashop/i.test(msg)) return NextResponse.json({ error: 'Questo sito sembra PrestaShop, non WooCommerce: collegalo dalla sezione PrestaShop.' }, { status: 400 })
    if (/<!doctype|<html[\s>]/i.test(msg)) return NextResponse.json({ error: 'Questo indirizzo non espone l\'API WooCommerce (risponde con una pagina web, non con i dati). Controlla che sia davvero un sito WooCommerce e che l\'API REST sia attiva su /wp-json/wc/v3.' }, { status: 400 })
    return NextResponse.json({ error: 'Impossibile raggiungere WooCommerce. Verifica URL e che le API REST siano attive. ' + msg.slice(0, 120) }, { status: 400 })
  }

  const payload: any = {
    master_id: utente.master_id,
    cliente_id: utente.cliente_id,
    piattaforma: 'woocommerce',
    nome_negozio: nome || url,
    identificativo: url,
    credenziali: { url, ck, cs },
    stato: 'attivo',
    errore: null,
  }
  const { data: existing } = await supabase.from('integrazioni').select('id')
    .eq('cliente_id', utente.cliente_id).eq('piattaforma', 'woocommerce').eq('identificativo', url).maybeSingle()
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)
  return NextResponse.json({ ok: true })
}
