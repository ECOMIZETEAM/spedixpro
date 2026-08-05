import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// COME SI CONTA IL PERIODO DI GIACENZA: e' una scelta del master, non nostra.
// I magazzini lavorano in due modi e nessuno dei due e' quello giusto — cambia solo cosa si
// racconta al cliente in fattura.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { data } = await createAdminSupabase().from('masters').select('logistica_periodo').eq('id', u.master_id).maybeSingle()
  return NextResponse.json({ periodo: data?.logistica_periodo || 'solare' })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const periodo = String(b.periodo || '')
  if (!['solare', 'giorni30'].includes(periodo)) return NextResponse.json({ error: 'Periodo non valido' }, { status: 400 })

  // Cambiare il modo NON rifattura e non storna niente: i periodi gia' addebitati restano dove
  // sono, con la loro chiave. Il nuovo modo vale dal prossimo periodo in poi.
  const { error } = await createAdminSupabase().from('masters').update({ logistica_periodo: periodo }).eq('id', u.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, periodo })
}
