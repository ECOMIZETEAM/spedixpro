import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

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

  try {
    const auth = Buffer.from(key + ':').toString('base64')
    const test = await fetch(url + '/api/', { headers: { 'Authorization': 'Basic ' + auth }, signal: AbortSignal.timeout(10000) })
    if (test.status === 401) return NextResponse.json({ error: 'Webservice Key non valida (401 non autorizzato)' }, { status: 400 })
    if (!test.ok) return NextResponse.json({ error: 'PrestaShop ha risposto con codice ' + test.status + '. Verifica URL e che il Webservice sia attivo.' }, { status: 400 })
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
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)
  return NextResponse.json({ ok: true })
}
