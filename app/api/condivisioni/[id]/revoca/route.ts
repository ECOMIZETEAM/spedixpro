import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'

/* Revoca una condivisione che HO CREATO io (sono il venditore). Solo lo stato → 'revocata': lo storico
 * non si cancella (REGOLE.md). In questa fetta non c'è ancora nulla da smontare (né api_key né ledger).
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()

  // Deve essere una MIA condivisione (sono il fornitore) e ancora viva.
  const { data: c } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,stato').eq('id', id).maybeSingle()
  if (!c || c.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Condivisione non trovata.' }, { status: 404 })
  if (!['in_attesa', 'attiva'].includes(c.stato)) return NextResponse.json({ error: 'Già chiusa.' }, { status: 409 })

  const { error } = await admin.from('corrieri_condivisi')
    .update({ stato: 'revocata', revocata_il: new Date().toISOString() }).eq('id', id)
  if (error) { console.error('[condivisioni/revoca]', error); return NextResponse.json({ error: 'Revoca non riuscita.' }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}
