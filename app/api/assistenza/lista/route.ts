import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Lista ticket:
// - ricevuti: ticket che il MIO master deve gestire (aperti da miei clienti o sotto-master)
// - miei: ticket che HO aperto io (verso la mia linea superiore, o come cliente)
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ricevuti: [], miei: [] })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const ruolo = (utente?.ruolo || '').toLowerCase()
  const admin = createAdminSupabase()

  const cols = 'id,oggetto,messaggio,stato,risposta,aperto_da,tipo_apertura,cliente_id,aperto_master_id,created_at,updated_at'

  if (ruolo === 'cliente') {
    const { data: miei } = await admin.from('tickets').select(cols)
      .eq('cliente_id', utente?.cliente_id).order('created_at', { ascending: false })
    return NextResponse.json({ ricevuti: [], miei: miei || [] })
  }

  // Master: ricevuti (owner = mio master) + miei (aperti dal mio master verso la linea superiore)
  const [{ data: ricevuti }, { data: miei }] = await Promise.all([
    admin.from('tickets').select(cols).eq('owner_master_id', masterId).order('created_at', { ascending: false }),
    admin.from('tickets').select(cols).eq('aperto_master_id', masterId).order('created_at', { ascending: false }),
  ])
  return NextResponse.json({ ricevuti: ricevuti || [], miei: miei || [] })
}
