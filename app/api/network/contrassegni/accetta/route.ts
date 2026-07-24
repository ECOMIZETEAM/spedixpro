import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Il target ACCETTA una rimessa contrassegni ricevuta dal padre. ACCETTA e basta:
// la propagazione ai propri clienti/sotto-master NON è più automatica — si fa da
// Contrassegni › Distinte Contrassegni selezionando le rimesse e premendo "Carica"
// (/api/contrassegni/carica-ricevute). Così il master sceglie QUANDO far scendere i soldi.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const body = await req.json()
  const distintaId = body.distintaId
  if (!distintaId) return NextResponse.json({ error: 'distintaId mancante' }, { status: 400 })

  const admin = createAdminSupabase()

  // La distinta ricevuta deve essere indirizzata al MIO master
  const { data: ricevuta } = await admin.from('distinte_contrassegni')
    .select('id,numero,target_master_id,accettata_target')
    .eq('id', distintaId).maybeSingle()
  if (!ricevuta || ricevuta.target_master_id !== mio) {
    return NextResponse.json({ error: 'Rimessa non trovata o non tua' }, { status: 404 })
  }
  if (ricevuta.accettata_target) {
    return NextResponse.json({ error: 'Rimessa già accettata' }, { status: 400 })
  }

  await admin.from('distinte_contrassegni')
    .update({ accettata_target: true, accettata_target_at: new Date().toISOString() })
    .eq('id', distintaId)

  return NextResponse.json({ success: true, numero: ricevuta.numero })
}
