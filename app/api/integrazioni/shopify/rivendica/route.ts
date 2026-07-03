import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Collega un negozio Shopify "pending" (autorizzato via OAuth partito da Shopify)
// all'account del cliente ora loggato.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono collegare negozi' }, { status: 403 })
  }
  const { data: cliente } = await supabase
    .from('clienti').select('master_id').eq('id', utente.cliente_id).single()

  const body = await req.json()
  const shop = (body.shop || '').trim().toLowerCase()
  if (!shop) return NextResponse.json({ error: 'Negozio mancante' }, { status: 400 })

  // Recupera il pending
  const { data: pend } = await supabase
    .from('shopify_pending').select('*').eq('shop', shop).maybeSingle()
  if (!pend) return NextResponse.json({ error: 'Nessun collegamento in attesa per questo negozio' }, { status: 404 })

  const payload: any = {
    master_id: cliente?.master_id || null,
    cliente_id: utente.cliente_id,
    piattaforma: 'shopify',
    nome_negozio: shop,
    identificativo: shop,
    credenziali: { access_token: pend.access_token, scope: pend.scope || '', shop },
    stato: 'attivo',
    errore: null,
  }
  const { data: existing } = await supabase
    .from('integrazioni').select('id')
    .eq('cliente_id', utente.cliente_id).eq('piattaforma', 'shopify').eq('identificativo', shop)
    .maybeSingle()
  if (existing?.id) await supabase.from('integrazioni').update(payload).eq('id', existing.id)
  else await supabase.from('integrazioni').insert(payload)

  // Consuma il pending
  await supabase.from('shopify_pending').delete().eq('shop', shop)

  return NextResponse.json({ ok: true, shop })
}
