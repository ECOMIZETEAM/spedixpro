import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester } from '@/lib/ripesature-harvester'
import { prioritaStato } from '@/lib/spedisci'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// LDV Spedisci CIECHE (senza cronologia) da leggere su OneTracking. Quando il webhook Spedisci non
// consegna (verificato: l'account amas dal 31/08 perde ~45% degli eventi), il tracking resta vuoto.
// Poste blocca gli IP dei server, quindi la lettura la fa lo script LOCALE (Mac, rete italiana): qui
// si dice solo QUALI leggere. L'anti-join su tracking_events fa avanzare il giro da solo.
export async function GET(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const limit = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 30))

  const { data: corr } = await admin.from('corrieri').select('id').eq('tipo', 'spedisci')
  const corrIds = (corr || []).map((c: any) => c.id)
  if (!corrIds.length) return NextResponse.json({ righe: [], restanti: 0 })

  // Candidate: non terminali, create tra 1 e 45 giorni fa (le <24h Poste non le ha ancora, gli
  // in_lavorazione vecchi invece sì: il corriere le ha prese, è il webhook che è mancato).
  const { data: cand } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,stato,created_at')
    .in('corriere_id', corrIds)
    .in('stato', ['in_lavorazione', 'spedita', 'in_transito', 'in_consegna', 'non_consegnato', 'in_giacenza'])
    .lt('created_at', new Date(Date.now() - 86400000).toISOString())
    .gt('created_at', new Date(Date.now() - 45 * 86400000).toISOString())
    .order('created_at', { ascending: true })
    .limit(1500)
  if (!cand?.length) return NextResponse.json({ righe: [], restanti: 0 })

  const ids = cand.map((c: any) => c.id)
  const conEventi = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: g } = await admin.from('tracking_events').select('spedizione_id').in('spedizione_id', ids.slice(i, i + 300))
    for (const r of (g || [])) conEventi.add((r as any).spedizione_id)
  }
  const cieche = cand.filter((c: any) => !conEventi.has(c.id))
    .sort((a: any, b: any) => prioritaStato(b.stato) - prioritaStato(a.stato))
  const righe = cieche.slice(0, limit).map((c: any) => ({ spedizione_id: c.id, ldv: c.tracking_number || c.numero }))
  return NextResponse.json({ righe, restanti: Math.max(0, cieche.length - righe.length) })
}
