import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Conteggio per il badge di notifica nel menu.
// - Cliente / sotto-master: aggiornamenti non letti sui propri ticket.
// - Master: ticket ricevuti ancora "aperti" (nuovi da gestire) + propri aggiornamenti non letti.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const admin = createAdminSupabase()
  const ruolo = (utente?.ruolo || '').toLowerCase()

  const cnt = async (q: any) => (await q).count || 0

  if (ruolo === 'cliente') {
    const count = await cnt(admin.from('tickets').select('id', { count: 'exact', head: true })
      .eq('cliente_id', utente?.cliente_id).eq('aperto_letto', false))
    return NextResponse.json({ count })
  }

  const [nuovi, mieiNonLetti] = await Promise.all([
    cnt(admin.from('tickets').select('id', { count: 'exact', head: true }).eq('owner_master_id', utente?.master_id).eq('stato', 'aperto')),
    cnt(admin.from('tickets').select('id', { count: 'exact', head: true }).eq('aperto_master_id', utente?.master_id).eq('aperto_letto', false)),
  ])
  return NextResponse.json({ count: nuovi + mieiNonLetti })
}
