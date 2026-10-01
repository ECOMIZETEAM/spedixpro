import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { abilitaContrattoCondiviso } from '@/lib/condivisione-engine'

/* Abilita un TUO contratto per un master collegato (flusso nuovo): mette il prezzo W (costo + ricarico)
 * nel listino d'ingrosso del collegato, gli crea chiave + corriere, e propaga costo/zone sul suo portale.
 * Nessuna riapprovazione: il consenso è stato dato al collegamento. Solo il VENDITORE del link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const corriereId = String(body?.corriere_id || '').trim()
  if (!corriereId) return NextResponse.json({ error: 'Scegli un contratto da condividere.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi').select('id,fornitore_master_id,stato').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })
  if (link.stato !== 'attiva') return NextResponse.json({ error: 'Il master deve prima approvare il collegamento.' }, { status: 409 })

  const r = await abilitaContrattoCondiviso(admin, { linkId: id, corriereId, markup: body?.markup })
  if (!r.ok) return NextResponse.json({ error: r.reason || 'Abilitazione non riuscita.' }, { status: 400 })
  return NextResponse.json({
    ok: true, attivo: !!r.propagazione?.ok, propagazione: r.propagazione,
    ...(r.propagazione?.ok ? {} : { avviso: 'Contratto abilitato ma senza costo propagato: controlla il listino di costo di questo contratto.' }),
  })
}
