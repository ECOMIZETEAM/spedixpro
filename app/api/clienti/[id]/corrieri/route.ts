import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data: corrieri } = await supabase.from('corrieri').select('id,tipo,nome_contratto,attivo').eq('master_id', utente?.master_id).order('nome_contratto')
  const { data: cliente } = await supabase.from('clienti').select('corrieri_abilitati').eq('id', id).single()
  const abilitati: string[] = cliente?.corrieri_abilitati || []
  // Un contratto in pausa - proprio o di un master SOPRA - non si puo' assegnare a un cliente:
  // qui si sceglie cosa il cliente potra' vendere, e a monte quella merce non partirebbe.
  // Resta visibile in Impostazioni -> Corrieri, dove serve per riattivarlo.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesi = await contrattiSospesiSopra(utente?.master_id)
  const disponibili = (corrieri || []).filter((c: any) =>
    c.attivo !== false && !sospesoDallaCatena(c.nome_contratto, sospesi))
  return NextResponse.json({ corrieri: disponibili, abilitati })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  await supabase.from('clienti').update({ corrieri_abilitati: body.abilitati }).eq('id', id).eq('master_id', utente?.master_id)
  return NextResponse.json({ success: true })
}