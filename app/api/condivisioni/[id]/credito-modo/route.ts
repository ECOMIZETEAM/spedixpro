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

  // SI RISPONDE CON QUELLO CHE C'E' SCRITTO, NON CON QUELLO CHE E' STATO CHIESTO. Un update che non
  // trova la riga non da' errore e aggiorna zero righe: rimandando indietro `modo` la schermata diceva
  // "fatto" anche quando non era cambiato niente. E' il motivo per cui su VTS EXPRESS risultava
  // impostato a credito a scalare mentre nel database era rimasto a fattura (2-3/10/2026).
  const { data: dopo } = await admin.from('corrieri_condivisi').select('credito_modo').eq('id', id).maybeSingle()
  const { data: contoDopo } = link.cliente_ledger_id
    ? await admin.from('clienti').select('tipo_contratto').eq('id', link.cliente_ledger_id).maybeSingle()
    : { data: null as any }
  // Senza conto-ledger la condizione resta scritta solo sul collegamento, e il motore del credito non
  // la guarda: va detto, altrimenti sembra impostata e non vale niente.
  const avviso = link.cliente_ledger_id ? null : 'Collegamento senza conto: la condizione non ha ancora effetto sul credito.'
  return NextResponse.json({
    ok: true, modo: dopo?.credito_modo ?? null, tipo_contratto: contoDopo?.tipo_contratto ?? null,
    ...(avviso ? { avviso } : {}),
  })
}
