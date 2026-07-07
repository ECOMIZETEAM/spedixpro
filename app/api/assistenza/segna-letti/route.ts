import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Segna come letti gli aggiornamenti dei ticket che ho aperto io (cliente o sotto-master).
export async function POST(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const admin = createAdminSupabase()
  const ruolo = (utente?.ruolo || '').toLowerCase()

  if (ruolo === 'cliente') {
    if (utente?.cliente_id) await admin.from('tickets').update({ aperto_letto: true }).eq('cliente_id', utente.cliente_id).eq('aperto_letto', false)
  } else if (utente?.master_id) {
    await admin.from('tickets').update({ aperto_letto: true }).eq('aperto_master_id', utente.master_id).eq('aperto_letto', false)
  }
  return NextResponse.json({ success: true })
}
