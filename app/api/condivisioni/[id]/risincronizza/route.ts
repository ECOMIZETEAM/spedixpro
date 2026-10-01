import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { risincronizzaCondivisione } from '@/lib/condivisione-engine'

/* Ri-sincronizza i costi di un collegamento: ri-propaga il listino d'ingrosso ATTUALE ai corrieri del
 * compratore (dopo che hai ritoccato i prezzi). Solo il VENDITORE del link. L'addebito era già live.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi').select('id,fornitore_master_id').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })
  const r = await risincronizzaCondivisione(admin, id)
  if (!r.ok) return NextResponse.json({ error: r.reason || 'Ri-sincronizzazione non riuscita.' }, { status: 400 })
  return NextResponse.json({ ok: true, contratti: r.contratti })
}
