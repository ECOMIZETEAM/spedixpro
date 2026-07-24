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

  const cols = 'id,codice,oggetto,messaggio,stato,risposta,aperto_da,tipo_apertura,cliente_id,aperto_master_id,aperto_letto,non_letto_owner,categoria,pod_url,allegati,created_at,updated_at,inoltrato_a_master_id,rete_master_ids,rete_non_letti'

  // Ordinamento per ULTIMA ATTIVITA' (updated_at): un ticket vecchio con una risposta fresca
  // del cliente deve risalire in cima, non restare sepolto (prima "spariva" dalla vista).
  if (ruolo === 'cliente') {
    const { data: miei } = await admin.from('tickets').select(cols)
      .eq('cliente_id', utente?.cliente_id).order('updated_at', { ascending: false })
    return NextResponse.json({ ricevuti: [], miei: miei || [] })
  }

  // Master: ricevuti (owner) + miei (aperti verso la linea superiore) + RETE (inoltrati a me
  // da un master sotto di me: partecipo alla catena, il cliente non mi vede).
  const [{ data: ricevuti }, { data: miei }, { data: rete }] = await Promise.all([
    admin.from('tickets').select(cols).eq('owner_master_id', masterId).order('updated_at', { ascending: false }),
    admin.from('tickets').select(cols).eq('aperto_master_id', masterId).order('updated_at', { ascending: false }),
    admin.from('tickets').select(cols).contains('rete_master_ids', [masterId]).order('updated_at', { ascending: false }),
  ])
  const conNuovo = (r: any) => ({ ...r, rete_nuovo: Array.isArray(r.rete_non_letti) && r.rete_non_letti.includes(masterId) })
  return NextResponse.json({ ricevuti: ricevuti || [], miei: miei || [], rete: (rete || []).map(conNuovo) })
}
