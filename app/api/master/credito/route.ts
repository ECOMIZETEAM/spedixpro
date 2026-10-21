import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { sezioniDelMaster } from '@/lib/movimenti-sezioni'

export const dynamic = 'force-dynamic'

// Credito del MASTER in topbar. Solo staff di rete (master/admin/operatore): il cliente ha il suo
// credito nel proprio portale, l'agente non ne ha.
//
// I CONTI SONO QUELLI DELLA LISTA MOVIMENTI (lib/movimenti-sezioni), non una lista a parte: l'intestazione
// e la pagina devono dire la stessa cosa. Prima qui c'erano solo il conto verso il padre e i ledger dei
// fornitori, e Wave vedeva due pillole (MULTIEXPRESS, LOGIXIA) senza i suoi GLS e BRT. Con un conto solo
// resta la pillola di sempre; da due in su, una tendina sola (Lorenzo, 21/10).
//
// Senza ?dettaglio=1 (a ogni cambio pagina e ogni 2 minuti) si contano solo i conti, senza sommare i
// contratti propri; i saldi completi si chiedono quando si apre la tendina.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (utente?.ruolo || '').toLowerCase()
  if (!utente?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ mostra: false })
  }
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const dettaglio = req.nextUrl.searchParams.get('dettaglio') === '1'
  try {
    const { sezioni } = await sezioniDelMaster(admin, utente.master_id, { saldiPropri: dettaglio })
    const rete = sezioni.find(s => s.id === 'rete')
    return NextResponse.json({
      mostra: true,
      rete: Number(rete?.saldo || 0),
      reteLabel: rete && rete.titolo !== 'Rete' ? rete.titolo : null,
      conti: sezioni.length,
      sezioni: dettaglio ? sezioni : undefined,
    })
  } catch (e: any) {
    console.error('[master/credito] conti:', e?.message)
    return NextResponse.json({ mostra: false })
  }
}
