import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Credito del MASTER (leggero): serve alla pillola in topbar, aggiornata ogni tanto. Solo staff di
// rete (master/admin/operatore): il cliente ha il suo credito nel proprio portale, l'agente non ne ha.
export async function GET() {
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
  const { data: m } = await admin.from('masters').select('credito,credito_proprio').eq('id', utente.master_id).maybeSingle()

  // CONDIVISIONE (due grafi): oltre al credito ALBERO (masters.credito, verso il padre), un master che
  // compra un contratto via CODICE ha il suo conto su un LEDGER "(ingrosso)" sotto il FORNITORE
  // (clienti.credito). E' invisibile a masters.credito e la RLS lo nasconde al client del master stesso
  // -> va letto via admin. La proprieta' si ricava SOLO da corrieri_condivisi (master=loggato, attiva):
  // mai un id dal client. Un conto per fornitore (somma dei ledger DISTINTI di quel fornitore).
  let ledger: { fornitore_master_id: string; fornitore: string; saldo: number }[] = []
  try {
    const { data: legami } = await admin.from('corrieri_condivisi')
      .select('fornitore_master_id,cliente_ledger_id')
      .eq('master_id', utente.master_id).eq('stato', 'attiva').not('cliente_ledger_id', 'is', null)
    const ledgerIds = [...new Set((legami || []).map((l: any) => l.cliente_ledger_id))]
    if (ledgerIds.length) {
      const fornIds = [...new Set((legami || []).map((l: any) => l.fornitore_master_id).filter(Boolean))]
      const [cliRes, fornRes] = await Promise.all([
        admin.from('clienti').select('id,credito').in('id', ledgerIds),
        admin.from('masters').select('id,nome').in('id', fornIds),
      ])
      const saldoLedger = new Map((cliRes.data || []).map((c: any) => [c.id, Number(c.credito || 0)]))
      const nomeForn = new Map((fornRes.data || []).map((f: any) => [f.id, f.nome]))
      const ledgerPerForn = new Map<string, Set<string>>()
      for (const l of (legami || [])) {
        if (!l.cliente_ledger_id || !l.fornitore_master_id) continue
        if (!ledgerPerForn.has(l.fornitore_master_id)) ledgerPerForn.set(l.fornitore_master_id, new Set())
        ledgerPerForn.get(l.fornitore_master_id)!.add(l.cliente_ledger_id)
      }
      ledger = [...ledgerPerForn.entries()].map(([fid, lids]) => ({
        fornitore_master_id: fid,
        fornitore: nomeForn.get(fid) || '—',
        saldo: [...lids].reduce((s, id) => s + (saldoLedger.get(id) || 0), 0),
      }))
    }
  } catch (e) { console.error('[master/credito] ledger codice:', e) }

  return NextResponse.json({
    mostra: true,
    rete: Number((m as any)?.credito || 0),
    proprio: Number((m as any)?.credito_proprio || 0),
    ledger,
  })
}
