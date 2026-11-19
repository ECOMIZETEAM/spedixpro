import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { wooGet, motivoCollegamentoWoo } from '@/lib/woo'

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
  // L'indirizzo come lo incollano: con /wp-admin/... in fondo (copiato dalla barra del pannello), senza
  // https://, con la barra finale. Serve la radice del sito.
  let url = (body.url || '').trim().replace(/\/wp-(admin|login\.php|json)\b.*$/i, '').replace(/\/+$/, '')
  let ck = (body.consumer_key || '').trim()
  let cs = (body.consumer_secret || '').trim()
  if (!url || !ck || !cs) return NextResponse.json({ error: 'Servono l\'indirizzo del negozio e i due codici della chiave: «Chiave Utente» (ck_…) e «Utente nascosto» (cs_…).' }, { status: 400 })
  if (!/^https?:\/\//.test(url)) url = 'https://' + url
  // I DUE CODICI. Nel pannello WooCommerce in italiano si chiamano «Chiave Utente» e «Utente nascosto»
  // (Consumer key / Consumer secret): incollati al contrario si rimettono a posto, altrimenti si dice
  // prima di chiamare il negozio che cosa manca.
  if (ck.startsWith('cs_') && cs.startsWith('ck_')) [ck, cs] = [cs, ck]
  if (!ck.startsWith('ck_') || !cs.startsWith('cs_')) {
    return NextResponse.json({ error: 'I codici non sono quelli della chiave WooCommerce: la «Chiave Utente» (Consumer key) inizia con ck_ e l\'«Utente nascosto» (Consumer secret) con cs_. Copiali dalla pagina che compare dopo «Genera chiave API».' }, { status: 400 })
  }

  // test connessione
  try {
    await wooGet(url, ck, cs, '/orders?per_page=1')
  } catch (e: any) {
    return NextResponse.json({ error: motivoCollegamentoWoo(e) }, { status: 400 })
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
