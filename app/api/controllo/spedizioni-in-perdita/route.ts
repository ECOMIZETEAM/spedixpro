import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { masterVedeReteCompleta } from '@/lib/rete-masters'
import { trovaSpedizioniInPerdita } from '@/lib/controllo-perdite'

// Centrale di Controllo — controllo "Spedizioni in perdita". SOLO super master: qui si legge tutta
// la rete con la chiave di servizio, e i costi a valle non devono uscire a un master qualunque.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  if (!(await masterVedeReteCompleta(admin, utente.master_id))) {
    return NextResponse.json({ error: 'Riservato al super master' }, { status: 403 })
  }

  const giorni = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('giorni') || '14', 10) || 14, 1), 90)
  try {
    const res = await trovaSpedizioniInPerdita(giorni)
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore nel controllo' }, { status: 500 })
  }
}
