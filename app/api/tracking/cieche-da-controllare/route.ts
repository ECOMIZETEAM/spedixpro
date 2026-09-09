import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester } from '@/lib/ripesature-harvester'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// LDV Spedisci CIECHE (senza cronologia) da leggere su OneTracking. Quando il webhook Spedisci non
// consegna (verificato: l'account amas dal 31/08 perde ~45% degli eventi), il tracking resta vuoto.
// Poste blocca gli IP dei server, quindi la lettura la fa lo script LOCALE (Mac, rete italiana): qui
// si dice solo QUALI leggere. L'RPC fa l'anti-join in SQL (niente cap a 1000) ed esclude le già
// controllate-vuote, così il giro avanza da solo e TERMINA.
export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const limit = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 30))

  const { data, error } = await admin.rpc('prossime_cieche_spedisci', { lim: limit })
  if (error) return NextResponse.json({ error: 'Errore lettura coda' }, { status: 500 })
  const righe = (data || []).map((r: any) => ({ spedizione_id: r.spedizione_id, ldv: r.ldv }))
  // `restanti` indicativo per il display: se il giro è pieno probabilmente ce ne sono altre.
  return NextResponse.json({ righe, restanti: righe.length >= limit ? limit : 0 })
}
