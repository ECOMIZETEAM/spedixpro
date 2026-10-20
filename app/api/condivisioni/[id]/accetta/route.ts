import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { anagraficaMasterPerLedger } from '@/lib/condivisione-engine'
import { tipoContrattoDaCreditoModo } from '@/lib/condivisione-credito'
import { emailContoLedger } from '@/lib/indirizzi-interni'

/* ACCETTA un collegamento ricevuto. Il COMPRATORE (acquirente = corrieri_condivisi.master_id) approva
 * il collegamento, e al consenso si crea solo il suo CLIENTE-LEDGER sotto il venditore, senza login:
 * vuoto, niente listino/chiave/corriere. I contratti li condivide poi il venditore assegnando un listino
 * dalla scheda del collegato (lib/condivisione-engine.ts), senza che il compratore riapprovi ogni volta.
 * Commit con guardia WHERE stato='in_attesa' (anti doppio-accetta); se qualcuno ha già accettato, si
 * smonta il ledger appena creato.
 *
 * Il vecchio ramo "per contratto" (condivisione con il contratto scelto all'origine) non c'è più: si
 * creava solo dal POST di /api/condivisioni, tolto, e montava il ponte senza la regola unica.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()

  const { data: c } = await admin.from('corrieri_condivisi')
    .select('id,corriere_id,master_id,fornitore_master_id,stato,credito_modo')
    .eq('id', id).maybeSingle()
  if (!c || c.master_id !== perm.masterId) return NextResponse.json({ error: 'Condivisione non trovata.' }, { status: 404 })
  if (c.stato !== 'in_attesa') return NextResponse.json({ error: 'Questa condivisione è già stata gestita.' }, { status: 409 })
  if (c.corriere_id) return NextResponse.json({ error: 'Richiesta del vecchio tipo: chiedi al fornitore di collegarti con il codice.' }, { status: 409 })

  const { data: compratore } = await admin.from('masters')
    .select('nome,piva,codice_fiscale,pec,telefono,indirizzo,citta,provincia,cap,indirizzo_operativo,citta_operativo,provincia_operativo,cap_operativo')
    .eq('id', c.master_id).maybeSingle()
  const nomeCompratore = compratore?.nome || 'Master'

  const { data: ledgerL, error: eLL } = await admin.from('clienti').insert({
    master_id: c.fornitore_master_id,
    ragione_sociale: `${nomeCompratore} (ingrosso)`,
    // Indirizzo inventato da noi, su un sottodominio nostro (lib/indirizzi-interni.ts): fino al
    // 20/10/2026 nasceva su moovexpress.app, un dominio che non e' nostro.
    email: emailContoLedger(c.id),
    codice_cliente: 'LDG-' + c.id.slice(0, 8).toUpperCase(),
    tipo_contratto: tipoContrattoDaCreditoModo(c.credito_modo),
    attivo: true, ledger: true,
    ...anagraficaMasterPerLedger(compratore),   // lo specchio dell'anagrafica del collegato (sola lettura)
  }).select('id').single()
  if (eLL || !ledgerL) { console.error('[condivisioni/accetta] ledger-link', eLL); return NextResponse.json({ error: 'Non sono riuscito a preparare il conto.' }, { status: 500 }) }
  const { data: updL } = await admin.from('corrieri_condivisi')
    .update({ stato: 'attiva', accettata_il: new Date().toISOString(), cliente_ledger_id: ledgerL.id })
    .eq('id', id).eq('stato', 'in_attesa').select('id')
  if (!updL || !updL.length) {
    await admin.from('clienti').delete().eq('id', ledgerL.id)
    return NextResponse.json({ error: 'Questo collegamento è già stato gestito.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, collegamento: true })
}
