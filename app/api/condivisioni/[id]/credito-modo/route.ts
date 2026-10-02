import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { tipoContrattoDaCreditoModo } from '@/lib/condivisione-credito'

/* Imposta le CONDIZIONI DI PAGAMENTO di un master collegato: prepagato (il suo conto si ferma a zero) o
 * a fattura (può andare sotto zero, es. fine mese). Aggiorna sia il collegamento (credito_modo) sia il
 * tipo_contratto del cliente-ledger, che è ciò che il motore credito/prenotazione guarda davvero. Solo il
 * VENDITORE del link. Vale a ogni livello (LOGIXIA→Wave, Wave→MULTI): ognuno decide per il SUO collegato.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const modo = String((await req.json().catch(() => ({})))?.modo || '').trim()
  if (modo !== 'prepagato' && modo !== 'fattura') return NextResponse.json({ error: 'Modo pagamento non valido.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,cliente_ledger_id').eq('id', id).maybeSingle()
  if (!link || link.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Collegamento non trovato.' }, { status: 404 })

  await admin.from('corrieri_condivisi').update({ credito_modo: modo }).eq('id', id)
  if (link.cliente_ledger_id) {
    // prepagato = credito_scalare (il motore prenota e si ferma a zero); fattura = può andare sotto.
    // La parola la decide lib/condivisione-credito: 'fattura' scritta qui dentro non esiste nel resto
    // della piattaforma (tendina della scheda cliente, fatture, report) e faceva sembrare che il tipo
    // contratto tornasse indietro da solo.
    await admin.from('clienti').update({ tipo_contratto: tipoContrattoDaCreditoModo(modo) }).eq('id', link.cliente_ledger_id)
  }
  return NextResponse.json({ ok: true, modo })
}
