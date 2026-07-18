import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Stato del tutorial di primo accesso del cliente (flag su clienti.impostazioni.tutorial_visto).
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ visto: true })
  const { data: u } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).single()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) return NextResponse.json({ visto: true })
  const { data: c } = await supabase.from('clienti').select('impostazioni').eq('id', u.cliente_id).single()
  return NextResponse.json({ visto: ((c as any)?.impostazioni?.tutorial_visto) === true })
}

// Segna il tutorial come visto.
export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).single()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) return NextResponse.json({ ok: true })
  const { data: c } = await supabase.from('clienti').select('impostazioni').eq('id', u.cliente_id).single()
  const impostazioni = { ...((c as any)?.impostazioni || {}), tutorial_visto: true }
  await supabase.from('clienti').update({ impostazioni }).eq('id', u.cliente_id)
  return NextResponse.json({ ok: true })
}
