import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const API_VERSION = '2026-04'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono sincronizzare' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const integrazioneId = body.integrazione_id
  if (!integrazioneId) return NextResponse.json({ error: 'integrazione_id mancante' }, { status: 400 })

  // Recupera l'integrazione (deve essere del cliente loggato)
  const { data: integr } = await supabase
    .from('integrazioni').select('*')
    .eq('id', integrazioneId).eq('cliente_id', utente.cliente_id).eq('piattaforma', 'shopify')
    .maybeSingle()
  if (!integr) return NextResponse.json({ error: 'Integrazione non trovata' }, { status: 404 })

  const cred = integr.credenziali as any
  const shop = cred?.shop
  const token = cred?.access_token
  if (!shop || !token) return NextResponse.json({ error: 'Credenziali Shopify mancanti' }, { status: 400 })

  // Legge ordini NON evasi da Shopify (tutti gli stati di pagamento)
  let ordini: any[] = []
  try {
    const apiUrl = `https://${shop}/admin/api/${API_VERSION}/orders.json?status=open&fulfillment_status=unfulfilled&limit=100`
    const r = await fetch(apiUrl, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    })
    if (!r.ok) {
      const t = await r.text()
      return NextResponse.json({ error: `Shopify ha risposto ${r.status}: ${t.slice(0,200)}` }, { status: 502 })
    }
    const d = await r.json()
    ordini = d.orders || []
  } catch (e: any) {
    return NextResponse.json({ error: 'Errore chiamata Shopify: ' + (e?.message || e) }, { status: 502 })
  }

  // Mappa e salva (upsert per non duplicare)
  let importati = 0
  for (const o of ordini) {
    const ship = o.shipping_address || o.billing_address || {}
    const destinatario = {
      nome: ship.name || `${ship.first_name || ''} ${ship.last_name || ''}`.trim(),
      indirizzo: [ship.address1, ship.address2].filter(Boolean).join(' '),
      citta: ship.city || '',
      provincia: ship.province_code || ship.province || '',
      cap: ship.zip || '',
      paese: ship.country_code || 'IT',
      email: o.email || o.contact_email || '',
      telefono: ship.phone || o.phone || '',
    }
    const articoli = (o.line_items || []).map((li: any) => ({
      nome: li.title, quantita: li.quantity, grammi: li.grams || 0, sku: li.sku || '',
    }))
    const payload: any = {
      cliente_id: utente.cliente_id,
      master_id: utente.master_id,
      integrazione_id: integrazioneId,
      piattaforma: 'shopify',
      ordine_esterno_id: String(o.id),
      numero_ordine: o.name || String(o.order_number || ''),
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: o.total_price ? Number(o.total_price) : null,
      valuta: o.currency || 'EUR',
      stato_pagamento: o.financial_status || '',
      raw: o,
    }
    const { error } = await supabase.from('ordini_ecommerce').upsert(payload, {
      onConflict: 'integrazione_id,ordine_esterno_id',
      ignoreDuplicates: false,
    })
    if (!error) importati++
  }

  // Aggiorna stato integrazione
  await supabase.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: ordini.length })
    .eq('id', integrazioneId)

  return NextResponse.json({ ok: true, letti: ordini.length, importati })
}
