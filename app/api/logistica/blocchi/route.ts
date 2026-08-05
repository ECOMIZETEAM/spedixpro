import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// I POSTI OCCUPATI IN MAGAZZINO.
//
// Una riga = un posto fisico assegnato a un cliente, con la sua ubicazione ("Reparto A - 52").
// `liberato_il` nullo significa "ancora occupato", ed e' quello che il giro mensile guardera' per
// sapere cosa fatturare.
//
// UN POSTO LIBERATO NON SI CANCELLA: resta come storico e come prova di cosa e' stato addebitato.
// E' la stessa regola che vale per spedizioni, ritiri e distinte.

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

// Il cliente dev'essere della RETE di chi sta scrivendo: senza questo, conoscendo un id qualsiasi
// si potrebbero occupare posti a nome di un cliente altrui.
async function clienteDellaRete(admin: any, masterId: string, clienteId: string) {
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, masterId)
  const { data: c } = await admin.from('clienti').select('id,master_id').eq('id', clienteId).maybeSingle()
  return c && rete.includes(c.master_id) ? c : null
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, s.master_id)

  let q = admin.from('logistica_blocchi')
    .select('*, logistica_tipi_blocco(nome,prezzo_mese), clienti(ragione_sociale)')
    .in('master_id', rete.length ? rete : ['00000000-0000-0000-0000-000000000000'])
    .order('occupato_dal', { ascending: false })
  const cliente = req.nextUrl.searchParams.get('cliente_id')
  if (cliente) q = q.eq('cliente_id', cliente)
  if (req.nextUrl.searchParams.get('solo_occupati') === '1') q = q.is('liberato_il', null)

  const { data, error } = await q.limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()

  // LIBERARE un posto: si scrive la data, non si cancella la riga.
  if (b.libera) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(admin, s.master_id)
    const { error } = await admin.from('logistica_blocchi')
      .update({ liberato_il: b.liberato_il || new Date().toISOString().slice(0, 10) })
      .eq('id', b.id).in('master_id', rete.length ? rete : ['00000000-0000-0000-0000-000000000000'])
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  const clienteId = String(b.cliente_id || '')
  if (!clienteId) return NextResponse.json({ error: 'Scegli il cliente' }, { status: 400 })
  const cliente = await clienteDellaRete(admin, s.master_id, clienteId)
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato nella tua rete' }, { status: 403 })

  const record: any = {
    master_id: cliente.master_id,      // il posto appartiene al master DEL CLIENTE, non a chi scrive
    cliente_id: clienteId,
    tipo_id: b.tipo_id || null,
    ubicazione: b.ubicazione ? String(b.ubicazione).trim() : null,
    nota: b.nota ? String(b.nota).trim() : null,
  }
  if (b.occupato_dal) record.occupato_dal = b.occupato_dal

  if (b.id) {
    const { error } = await admin.from('logistica_blocchi').update(record).eq('id', b.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    record.created_by = s.user.id
    const { error } = await admin.from('logistica_blocchi').insert(record)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
