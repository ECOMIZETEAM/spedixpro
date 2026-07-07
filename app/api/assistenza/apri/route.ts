import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Apertura di un ticket di assistenza.
// - Cliente: il ticket va al proprio master (owner = master del cliente).
// - Sotto-master: il ticket va alla linea superiore (owner = parent del proprio master).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  if (!masterId) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const body = await req.json()
  const oggetto = String(body?.oggetto || '').trim()
  const messaggio = String(body?.messaggio || '').trim()
  if (!oggetto || !messaggio) return NextResponse.json({ error: 'Oggetto e messaggio sono obbligatori' }, { status: 400 })

  const admin = createAdminSupabase()
  const ruolo = (utente?.ruolo || '').toLowerCase()

  const record: any = { oggetto, messaggio, stato: 'aperto' }

  if (ruolo === 'cliente') {
    if (!utente?.cliente_id) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
    const { data: cli } = await admin.from('clienti').select('ragione_sociale').eq('id', utente.cliente_id).maybeSingle()
    record.owner_master_id = masterId
    record.cliente_id = utente.cliente_id
    record.aperto_da = cli?.ragione_sociale || 'Cliente'
    record.tipo_apertura = 'cliente'
  } else {
    // È un master: il ticket va alla sua linea superiore
    const { data: m } = await admin.from('masters').select('nome,parent_master_id').eq('id', masterId).maybeSingle()
    if (!m?.parent_master_id) {
      return NextResponse.json({ error: 'Sei il master principale: non hai una linea superiore a cui aprire un ticket.' }, { status: 400 })
    }
    record.owner_master_id = m.parent_master_id
    record.aperto_master_id = masterId
    record.aperto_da = m?.nome || 'Master'
    record.tipo_apertura = 'master'
  }

  const { data, error } = await admin.from('tickets').insert(record).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, id: data?.id })
}
