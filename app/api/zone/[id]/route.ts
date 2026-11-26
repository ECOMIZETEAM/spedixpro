import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { staffDelMaster, zoneNonModificabili } from '@/lib/zone-catena'

// Le zone le porta alle copie il DATABASE (scripts/zone-catena-trigger.sql, 26/11/2026): nome, descrizione, fuel,
// multicollo e partenza seguono da soli in ogni contratto che compra questo, e una zona cancellata sparisce anche lì.
// Prima lo faceva lib/propaga-zona, e solo per il segno multicollo e il fuel: un nome cambiato o una zona cancellata
// restavano nelle copie (32 zone vuote tolte il 26/11).

// I campi che il portale può cambiare. Prima il corpo della richiesta andava tale e quale nella UPDATE.
const CAMPI = ['nome', 'descrizione', 'con_fuel', 'multicollo', 'su_mittente', 'corriere_id'] as const

// La zona, se è del master, e il messaggio se non la può modificare (contratto comprato o staccato).
async function zonaDelMaster(supabase: any, userId: string, id: string) {
  const masterId = await staffDelMaster(supabase, userId)
  if (!masterId) return { errore: 'Solo lo staff del master può modificare le zone.', stato: 403 }
  const { data: zona } = await supabase.from('zone').select('id,nome,corriere_id,master_id').eq('id', id).maybeSingle()
  if (!zona || zona.master_id !== masterId) return { errore: 'Zona non trovata.', stato: 404 }
  const bloccato = await zoneNonModificabili(createAdminSupabase(), zona.corriere_id, masterId)
  if (bloccato) return { errore: bloccato, stato: 403 }
  return { zona, masterId }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const z = await zonaDelMaster(supabase, user.id, id)
  if ('errore' in z) return NextResponse.json({ error: z.errore }, { status: z.stato })
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = {}
  for (const k of CAMPI) if (body && body[k] !== undefined) patch[k] = body[k]
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Niente da modificare' }, { status: 400 })
  // Spostata su un altro contratto: anche quello dev'essere suo e proprio.
  if (patch.corriere_id !== undefined && patch.corriere_id !== z.zona.corriere_id) {
    const bloccato = await zoneNonModificabili(createAdminSupabase(), patch.corriere_id, z.masterId)
    if (bloccato) return NextResponse.json({ error: bloccato }, { status: 403 })
  }
  const { data, error } = await supabase.from('zone').update(patch).eq('id', id).select('id')
  if (error) {
    const msg = /zone_una_per_chiave/.test(error.message)
      ? 'Su questo contratto c’è già una zona con questo nome (o la stessa zona multicollo): scegline un altro.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  if (!data?.length) return NextResponse.json({ error: 'Zona non modificata.' }, { status: 403 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const z = await zonaDelMaster(supabase, user.id, id)
  if ('errore' in z) return NextResponse.json({ error: z.errore }, { status: z.stato })
  const { data, error } = await supabase.from('zone').delete().eq('id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data?.length) return NextResponse.json({ error: 'Zona non eliminata.' }, { status: 403 })
  return NextResponse.json({ success: true })
}
