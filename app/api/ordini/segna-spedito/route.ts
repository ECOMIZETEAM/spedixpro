import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const ordineId = body.ordine_id
  const spedizioneId = body.spedizione_id || null
  if (!ordineId) return NextResponse.json({ error: 'ordine_id mancante' }, { status: 400 })

  // L'ordine puo' venire dalla sync API (ordini_ecommerce) o dall'import CSV (ordini_importati):
  // aggiorno per id in entrambe, aggiorna solo la tabella che contiene davvero quell'id.
  await supabase.from('ordini_ecommerce')
    .update({ stato: 'spedito', spedizione_id: spedizioneId })
    .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
  await supabase.from('ordini_importati')
    .update({ stato: 'spedito', spedizione_id: spedizioneId, errore: null })
    .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
  return NextResponse.json({ ok: true })
}
