import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { generaApiKey } from '@/lib/api-auth'

/* ACCETTA una condivisione ricevuta (Fase 3). Il COMPRATORE (acquirente = corrieri_condivisi.master_id)
 * consente, e al consenso si monta la contabilità — riusando i meccanismi esistenti (vedi CONDIVISIONE-
 * CONTRATTI.md e la ricognizione):
 *   1) CLIENTE-LEDGER senza login sotto il VENDITORE, agganciato al listino d'ingrosso (Fase 2);
 *   2) API_KEY per (ledger, contratto del venditore) — è la credenziale che il compratore userà;
 *   3) riga CORRIERE lato compratore tipo='moovexpress' con dentro la key — MATERIALIZZATA ma attiva=false
 *      finché la Fase 4 (lib/moovexpress.ts) non la fa funzionare davvero (niente contratto monco in prod).
 * Commit atomico-in-pratica: la condivisione passa a 'attiva' con guardia WHERE stato='in_attesa' (anti
 * doppio-accetta); se qualcosa fallisce o qualcuno ha già accettato, si smonta ciò che si è creato.
 *
 * Nessun motore prezzi/credito toccato: si CREANO righe (cliente/key/corriere), non si addebita nulla.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()

  const { data: c } = await admin.from('corrieri_condivisi')
    .select('id,corriere_id,master_id,fornitore_master_id,stato,credito_modo,listino_ingrosso_id')
    .eq('id', id).maybeSingle()
  if (!c || c.master_id !== perm.masterId) return NextResponse.json({ error: 'Condivisione non trovata.' }, { status: 404 })
  if (c.stato !== 'in_attesa') return NextResponse.json({ error: 'Questa condivisione è già stata gestita.' }, { status: 409 })
  if (!c.listino_ingrosso_id) return NextResponse.json({ error: 'Manca il listino d’ingrosso: chiedi al fornitore di rifare la condivisione.' }, { status: 400 })

  const [{ data: contratto }, { data: compratore }] = await Promise.all([
    admin.from('corrieri').select('nome_contratto').eq('id', c.corriere_id).maybeSingle(),
    admin.from('masters').select('nome').eq('id', c.master_id).maybeSingle(),
  ])
  const nomeCompratore = compratore?.nome || 'Master'

  // 1) CLIENTE-LEDGER sotto il venditore, SENZA login (niente auth.createUser né riga utenti).
  //    credito parte da 0 (trigger fn_credito_solo_via_rpc), api_esente=true di default. Email sintetica
  //    unica dallo share id. tipo_contratto = modo credito scelto sulla condivisione.
  const { data: ledger, error: eL } = await admin.from('clienti').insert({
    master_id: c.fornitore_master_id,
    ragione_sociale: `${nomeCompratore} (ingrosso)`,
    email: `ledger-${c.id}@ledger.moovexpress.app`,
    codice_cliente: 'LDG-' + c.id.slice(0, 8).toUpperCase(),
    tipo_contratto: c.credito_modo === 'fattura' ? 'fattura' : 'credito_scalare',
    attivo: true, ledger: true,
    listino_cliente_id: c.listino_ingrosso_id,
  }).select('id').single()
  if (eL || !ledger) { console.error('[condivisioni/accetta] ledger', eL); return NextResponse.json({ error: 'Non sono riuscito a preparare il conto.' }, { status: 500 }) }

  // 2) API_KEY per (ledger, contratto del venditore).
  const chiave = generaApiKey()
  const { error: eK } = await admin.from('api_keys').insert({
    master_id: c.fornitore_master_id, cliente_id: ledger.id, corriere_id: c.corriere_id,
    chiave, nome: `moovexpress ${nomeCompratore}`.slice(0, 80), attivo: true,
  })
  if (eK) {
    console.error('[condivisioni/accetta] api_key', eK)
    await admin.from('clienti').delete().eq('id', ledger.id)
    return NextResponse.json({ error: 'Non sono riuscito a emettere la chiave.' }, { status: 500 })
  }

  // 3) Riga CORRIERE lato compratore (materializzata, attiva=false finché la Fase 4 non la accende).
  const { data: corrNuovo, error: eC } = await admin.from('corrieri').insert({
    master_id: c.master_id, tipo: 'moovexpress',
    nome_contratto: contratto?.nome_contratto || 'Contratto partner',
    credenziali: { api_key: chiave, fornitore_master_id: c.fornitore_master_id, corriere_origine_id: c.corriere_id },
    settings: {}, multicollo: true, inserimento_ritiri: true, attivo: false, livello: 1, proprio: false,
  }).select('id').single()
  if (eC || !corrNuovo) {
    console.error('[condivisioni/accetta] corriere', eC)
    await admin.from('api_keys').delete().eq('cliente_id', ledger.id).eq('corriere_id', c.corriere_id)
    await admin.from('clienti').delete().eq('id', ledger.id)
    return NextResponse.json({ error: 'Non sono riuscito a creare il contratto.' }, { status: 500 })
  }

  // 4) COMMIT con guardia anti doppio-accetta: solo se è ANCORA 'in_attesa'.
  const { data: upd } = await admin.from('corrieri_condivisi')
    .update({ stato: 'attiva', accettata_il: new Date().toISOString(), cliente_ledger_id: ledger.id, corriere_acquirente_id: corrNuovo.id })
    .eq('id', id).eq('stato', 'in_attesa').select('id')
  if (!upd || !upd.length) {
    // Qualcun altro ha accettato nel frattempo: smonto tutto ciò che ho creato.
    await admin.from('corrieri').delete().eq('id', corrNuovo.id)
    await admin.from('api_keys').delete().eq('cliente_id', ledger.id).eq('corriere_id', c.corriere_id)
    await admin.from('clienti').delete().eq('id', ledger.id)
    return NextResponse.json({ error: 'Questa condivisione è già stata gestita.' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, contratto: contratto?.nome_contratto || 'Contratto partner' })
}
