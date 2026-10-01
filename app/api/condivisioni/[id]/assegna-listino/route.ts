import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { assegnaListinoCondivisione } from '@/lib/condivisione-engine'

/* Assegna un listino GIÀ FATTO (Listini Clienti) al master collegato: diventa il prezzo d'ingrosso e i
 * contratti condivisibili dentro vengono materializzati sul compratore. Solo il VENDITORE del link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const listinoId = String((await req.json().catch(() => ({})))?.listino_id || '').trim()
  if (!listinoId) return NextResponse.json({ error: 'Scegli un listino.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi').select('id,fornitore_master_id').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })

  const r = await assegnaListinoCondivisione(admin, { linkId: id, listinoId })
  if (!r.ok) return NextResponse.json({ error: r.reason || 'Assegnazione non riuscita.' }, { status: 400 })
  return NextResponse.json({ ok: true, condivisi: r.condivisi || [], saltati: r.saltati || [] })
}
