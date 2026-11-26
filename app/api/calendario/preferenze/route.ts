import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// LE SCELTE DI UNA PERSONA SUL CALENDARIO (fase 3): per ora il riepilogo del mattino, SPENTO finché non lo accende
// lei (Lorenzo 26/11: «chi lo attiva»). Tabella calendario_preferenze, solo col client di servizio, riga di chi chiama.
async function chi() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await chi()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data, error } = await createAdminSupabase().from('calendario_preferenze').select('riepilogo_mattino').eq('utente_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Lettura non riuscita: ' + error.message }, { status: 500 })
  return NextResponse.json({ riepilogo_mattino: !!data?.riepilogo_mattino })
}

export async function POST(req: NextRequest) {
  const user = await chi()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  if (typeof b?.riepilogo_mattino !== 'boolean') return NextResponse.json({ error: 'Scelta non valida' }, { status: 400 })
  const { error } = await createAdminSupabase().from('calendario_preferenze')
    .upsert({ utente_id: user.id, riepilogo_mattino: b.riepilogo_mattino, aggiornato_il: new Date().toISOString() }, { onConflict: 'utente_id' })
  if (error) return NextResponse.json({ error: 'Non salvato: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true, riepilogo_mattino: b.riepilogo_mattino })
}
