import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'

/* RIFIUTA una condivisione ricevuta: il COMPRATORE (acquirente = master_id) declina. Solo stato →
 * 'rifiutata', niente da smontare (l'accetta non è mai avvenuto). Lo storico resta (REGOLE.md). */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()

  const { data: c } = await admin.from('corrieri_condivisi').select('id,master_id,stato').eq('id', id).maybeSingle()
  if (!c || c.master_id !== perm.masterId) return NextResponse.json({ error: 'Condivisione non trovata.' }, { status: 404 })
  if (c.stato !== 'in_attesa') return NextResponse.json({ error: 'Già gestita.' }, { status: 409 })

  const { error } = await admin.from('corrieri_condivisi')
    .update({ stato: 'rifiutata' }).eq('id', id).eq('stato', 'in_attesa')
  if (error) { console.error('[condivisioni/rifiuta]', error); return NextResponse.json({ error: 'Rifiuto non riuscito.' }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}
