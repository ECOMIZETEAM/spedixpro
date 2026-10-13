import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'

/* COLLEGA un master tramite il suo codice (flusso nuovo, CONDIVISIONE-CONTRATTI.md). Crea SOLO il
 * collegamento (corriere_id NULL, stato 'in_attesa'): il collegato deve APPROVARE (è l'unico consenso).
 * Dopo l'approvazione compare come cliente del venditore, che dalla sua scheda gli assegna un listino:
 * i contratti dentro gli vengono condivisi (lib/condivisione-engine.ts).
 * Isolamento a mano (corrieri_condivisi è service-role): solo master/admin, il codice risolve il compratore.
 */
export async function POST(req: NextRequest) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const codice = String((await req.json().catch(() => ({})))?.codice || '').trim().toUpperCase()
  if (!codice) return NextResponse.json({ error: 'Inserisci il codice del master da collegare.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: buyer } = await admin.from('masters').select('id,nome').eq('codice_condivisione', codice).maybeSingle()
  if (!buyer) return NextResponse.json({ error: 'Codice non valido.' }, { status: 404 })
  if (buyer.id === perm.masterId) return NextResponse.json({ error: 'Non puoi collegare te stesso.' }, { status: 400 })

  // Un solo collegamento VIVO (in attesa o attivo) per coppia venditore→compratore, di qualunque tipo:
  // anche uno vecchio (un contratto solo, come LOGIXIA → Wave). Il ponte si riconosce da venditore e
  // contratto d'origine, quindi un secondo collegamento vedrebbe — e potrebbe spegnere o ri-chiavare —
  // i ponti del primo.
  const { data: gia, error: eGia } = await admin.from('corrieri_condivisi')
    .select('id,stato').eq('fornitore_master_id', perm.masterId).eq('master_id', buyer.id)
    .in('stato', ['in_attesa', 'attiva']).limit(1)
  if (eGia) return NextResponse.json({ error: 'Controllo dei collegamenti non riuscito: riprova.' }, { status: 500 })
  if (gia?.length) return NextResponse.json({ error: `${buyer.nome} è già collegato (${gia[0].stato === 'attiva' ? 'attivo' : 'in attesa di approvazione'}).` }, { status: 409 })

  const { data: creata, error } = await admin.from('corrieri_condivisi').insert({
    fornitore_master_id: perm.masterId, master_id: buyer.id, corriere_id: null,
    stato: 'in_attesa', credito_modo: 'prepagato',
  }).select('id').single()
  if (error || !creata) { console.error('[condivisioni/collega]', error); return NextResponse.json({ error: 'Collegamento non riuscito.' }, { status: 500 }) }

  return NextResponse.json({ ok: true, id: creata.id, compratore: buyer.nome })
}
