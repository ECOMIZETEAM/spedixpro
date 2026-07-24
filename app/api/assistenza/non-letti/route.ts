import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Conteggio notifiche separato per Ticket e POD.
// - Cliente/sotto-master: aggiornamenti non letti sui propri ticket/pod.
// - Master: ticket/pod ricevuti ancora "aperti" + propri aggiornamenti non letti.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0, ticket: 0, pod: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const admin = createAdminSupabase()
  const ruolo = (utente?.ruolo || '').toLowerCase()
  const cat = (r: any) => (r.categoria === 'pod' ? 'pod' : 'ticket')

  let ticket = 0, pod = 0

  if (ruolo === 'cliente') {
    const { data } = await admin.from('tickets').select('categoria').eq('cliente_id', utente?.cliente_id).eq('aperto_letto', false)
    for (const r of (data || [])) { if (cat(r) === 'pod') pod++; else ticket++ }
  } else if (utente?.master_id) {
    const [{ data: ric }, { data: miei }, { data: rete }] = await Promise.all([
      // Ricevuti: da leggere per l'assistenza (nuovo ticket o risposta del richiedente), esclusi i chiusi.
      admin.from('tickets').select('categoria').eq('owner_master_id', utente.master_id).eq('non_letto_owner', true).neq('stato', 'chiuso'),
      // I miei (aperti verso la linea superiore): aggiornamenti non ancora letti.
      admin.from('tickets').select('categoria').eq('aperto_master_id', utente.master_id).eq('aperto_letto', false),
      // Rete: ticket inoltrati a me con aggiornamenti che non ho ancora letto.
      admin.from('tickets').select('categoria').contains('rete_non_letti', [utente.master_id]).neq('stato', 'chiuso'),
    ])
    for (const r of [...(ric || []), ...(miei || []), ...(rete || [])]) { if (cat(r) === 'pod') pod++; else ticket++ }
  }

  return NextResponse.json({ count: ticket + pod, ticket, pod })
}
