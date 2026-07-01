import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()

  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const url = new URL(req.url)
  const stato = url.searchParams.get('stato') // opzionale: da_spedire | spedito | ...

  let q = supabase
    .from('ordini_importati')
    .select('*')
    .eq('cliente_id', utente.cliente_id)   // isolamento: solo ordini del cliente in sessione
    .order('created_at', { ascending: false })

  if (stato) q = q.eq('stato', stato)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ordini: data || [] })
}
