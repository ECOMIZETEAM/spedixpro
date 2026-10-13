import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase'
import { getPermessiUtente } from '@/lib/permessi'
import { assegnaListinoCondivisione } from '@/lib/condivisione-engine'

/* Assegna un listino GIÀ FATTO (Listini Clienti) al master collegato: diventa il prezzo d'ingrosso e i
 * contratti dentro vengono condivisi secondo la regola unica (lib/condivisione-engine.ts). Se qualche
 * contratto prende il posto di copie del collegato che il suo master gli ha tolto, la prima chiamata
 * non scrive niente e risponde `serve_conferma` coi numeri e un'impronta: la seconda, con
 * `conferma: <impronta>`, esegue — solo se il piano è ancora quello mostrato. Solo il VENDITORE del link.
 */
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const listinoId = String(body?.listino_id || '').trim()
  if (!listinoId) return NextResponse.json({ error: 'Scegli un listino.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi').select('id,fornitore_master_id').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })

  // Chi ha deciso resta nel registro, se l'Assegna toglie copie del collegato.
  const { data: { user } } = await (await createServerSupabase()).auth.getUser()
  try {
    const r = await assegnaListinoCondivisione(admin, {
      linkId: id, listinoId, conferma: typeof body?.conferma === 'string' ? body.conferma : undefined,
      attore: { uid: user?.id || null, nome: perm.nome || user?.email || null },
    })
    if (!r.ok) return NextResponse.json({ error: r.reason || 'Assegnazione non riuscita.' }, { status: 400 })
    if (r.serveConferma) return NextResponse.json({ ok: true, serve_conferma: true, da_confermare: r.daConfermare || [], scoperti: r.scoperti || [], impronta: r.impronta })
    return NextResponse.json({ ok: true, condivisi: r.condivisi || [], sostituiti: r.sostituiti || [], saltati: r.saltati || [] })
  } catch (e: any) {
    // Le letture che decidono cosa togliere lanciano se falliscono: non si è tolto niente.
    console.error('[condivisioni/assegna-listino]', id, e?.message)
    return NextResponse.json({ error: 'Non sono riuscito a leggere tutto quello che serve: non è stato cambiato niente, riprova.' }, { status: 500 })
  }
}
