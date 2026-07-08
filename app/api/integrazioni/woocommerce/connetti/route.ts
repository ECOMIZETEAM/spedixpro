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
