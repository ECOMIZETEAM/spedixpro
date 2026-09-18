import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester } from '@/lib/ripesature-harvester'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// CONSEGNATE SENZA STORIA da riempire leggendo OneTracking dal Mac (Poste blocca gli IP dei server,
// quindi qui si dice solo QUALI). Sono i pacchi arrivati di cui il cliente, aprendo il tracking, non
// vede niente: 66.918 al 18/09/2026, perche' il cron guarda solo le spedizioni attive e chi diventa
// "consegnata" prima del suo turno non viene piu' ripescato da nessuno.
// L'anti-join lo fa l'RPC in SQL (niente cap a 1000) ed esclude quelle gia' cercate di recente, cosi'
// il giro avanza da solo e prima o poi TERMINA.
export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 200))

  const { data, error } = await admin.rpc('prossime_cronologie_da_recuperare', { lim: limit })
  if (error) return NextResponse.json({ error: 'Errore lettura coda' }, { status: 500 })
  const righe = (data || []).map((r: any) => ({ spedizione_id: r.spedizione_id, ldv: r.ldv }))
  return NextResponse.json({ righe, restanti: righe.length >= limit ? limit : 0 })
}
