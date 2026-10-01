import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { disabilitaContrattoCondiviso } from '@/lib/condivisione-engine'

/* Toglie un contratto a un master collegato: spegne/rimuove il corriere sul compratore, revoca la chiave,
 * ripulisce il listino. Lo STORICO non si cancella: se il corriere ha spedizioni, si DISATTIVA. Solo il
 * VENDITORE del link. Il collegamento resta (puoi riabilitare altri contratti).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const corriereId = String((await req.json().catch(() => ({})))?.corriere_id || '').trim()
  if (!corriereId) return NextResponse.json({ error: 'Contratto mancante.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi').select('id,fornitore_master_id').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })

  const r = await disabilitaContrattoCondiviso(admin, { linkId: id, corriereId })
  if (!r.ok) return NextResponse.json({ error: r.reason || 'Operazione non riuscita.' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
