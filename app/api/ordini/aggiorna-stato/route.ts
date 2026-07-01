import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

const STATI = ['da_spedire', 'spedito', 'errore', 'archiviato']

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { id, stato, errore, numero } = await req.json()
  if (!id || !STATI.includes(stato)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const patch: Record<string, any> = {
    stato,
    errore: stato === 'errore' ? (errore || 'Errore sconosciuto') : null,
  }

  // Best-effort: collega la spedizione creata cercandola per numero
  if (numero && stato === 'spedito') {
    const { data: sped } = await supabase
      .from('spedizioni').select('id')
      .eq('cliente_id', utente.cliente_id)
      .eq('numero', numero)
      .limit(1).maybeSingle()
    if (sped?.id) patch.spedizione_id = sped.id
  }

  const { error } = await supabase
    .from('ordini_importati')
    .update(patch)
    .eq('id', id)
    .eq('cliente_id', utente.cliente_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
