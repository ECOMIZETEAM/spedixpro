import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Decisione del master ricevente su una rettifica di catena: 'propagata' o 'assorbita'.
// La riga appartiene al master PADRE -> update via admin; autorizzazione = target_master_id mio.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  // Il ruolo, non l'elenco di quelli da tenere fuori: escludendo il solo 'cliente' passava
  // l'AUTISTA, che un master_id ce l'ha (3 in produzione) — e qui sotto si legge e si scrive con la
  // chiave di servizio, che scavalca le regole per riga.
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const { rettifica_id, decisione } = body
  if (!rettifica_id || !['propagata', 'assorbita', null].includes(decisione)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }
  const adminDb = createAdminSupabase()
  const { data: r } = await adminDb.from('rettifiche')
    .select('id,target_master_id').eq('id', rettifica_id).maybeSingle()
  if (!r || r.target_master_id !== utente.master_id) {
    return NextResponse.json({ error: 'Rettifica non trovata' }, { status: 404 })
  }
  const { error } = await adminDb.from('rettifiche')
    .update({ propagazione: decisione }).eq('id', rettifica_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
