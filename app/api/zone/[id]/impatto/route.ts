import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { staffDelMaster } from '@/lib/zone-catena'

// Prima di cancellare una zona si dice cosa c'è attaccato più giù nella catena, con i numeri: la zona sparisce anche
// da ogni contratto che la compra (scripts/zone-catena-trigger.sql), e i prezzi che quei master le avevano dato
// finiscono in archivio. Solo totali: chi sono non si dice.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const masterId = await staffDelMaster(supabase, user.id)
  if (!masterId) return NextResponse.json({ error: 'Solo lo staff del master.' }, { status: 403 })
  const { data: zona } = await supabase.from('zone').select('id,master_id').eq('id', id).maybeSingle()
  if (!zona || zona.master_id !== masterId) return NextResponse.json({ error: 'Zona non trovata.' }, { status: 404 })
  const { data, error } = await createAdminSupabase().rpc('zona_copie_impatto', { p_zona: id })
  // Senza i numeri la conferma non si può dare con cognizione: lo si dice, non si mostra zero.
  if (error) return NextResponse.json({ error: 'Non riesco a contare le copie di questa zona in questo momento.' }, { status: 503 })
  const r = (Array.isArray(data) ? data[0] : data) || {}
  return NextResponse.json({
    contratti: Number(r.contratti) || 0, master: Number(r.master) || 0,
    prezzi: (Number(r.prezzi_vendita) || 0) + (Number(r.prezzi_costo) || 0),
  })
}
