import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { risincronizzaCondivisione } from '@/lib/condivisione-engine'

/* Il bottone "Aggiorna" della scheda del collegato: riporta il costo sui contratti già condivisi e crea
 * quelli aggiunti al listino dopo l'Assegna. Non sostituisce copie del collegato (lo fa l'Assegna, su
 * conferma). Solo un master del VENDITORE del link. L'addebito era già giusto.
 */
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi').select('id,fornitore_master_id').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })
  try {
    const r = await risincronizzaCondivisione(admin, id, { creaMancanti: true })
    if (!r.ok) return NextResponse.json({ error: r.reason || 'Aggiornamento non riuscito.' }, { status: 400 })
    return NextResponse.json({ ok: true, contratti: r.contratti, creati: r.creati || [], da_attivare: r.daAttivare || [], da_confermare: r.daConfermare || [], saltati: r.saltati || [] })
  } catch (e: any) {
    console.error('[condivisioni/risincronizza]', id, e?.message)
    return NextResponse.json({ error: 'Non sono riuscito a leggere tutto quello che serve: riprova.' }, { status: 500 })
  }
}
