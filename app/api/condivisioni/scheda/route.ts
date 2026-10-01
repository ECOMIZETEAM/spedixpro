import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { isProviderTecnico } from '@/lib/corriere-logo'

/* Dati della sezione "Contratti condivisi" sulla scheda di un master collegato (il cliente-ledger).
 * Torna il collegamento attivo di QUESTO master verso quel ledger + l'elenco dei miei contratti
 * condivisibili con lo stato (abilitato o no). Serve alla scheda cliente per abilitare/disabilitare.
 * Solo il VENDITORE (fornitore del link). Se il cliente non è un ledger collegato a me → { link: null }.
 */
export async function GET(req: NextRequest) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const clienteId = (req.nextUrl.searchParams.get('cliente_id') || '').trim()
  if (!clienteId) return NextResponse.json({ link: null })

  const admin = createAdminSupabase()
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,master_id,stato').eq('cliente_ledger_id', clienteId)
    .eq('fornitore_master_id', perm.masterId).is('corriere_id', null).eq('stato', 'attiva').maybeSingle()
  if (!link) return NextResponse.json({ link: null })

  const [{ data: buyer }, { data: miei }, { data: buyerCorrieri }] = await Promise.all([
    admin.from('masters').select('nome').eq('id', link.master_id).maybeSingle(),
    admin.from('corrieri').select('id,nome_contratto,tipo').eq('master_id', perm.masterId).eq('attivo', true).neq('tipo', 'moovexpress').order('nome_contratto'),
    admin.from('corrieri').select('id,credenziali,attivo').eq('master_id', link.master_id).eq('tipo', 'moovexpress'),
  ])
  // Contratti già abilitati per questo collegato = quelli con un corriere moovexpress ATTIVO sul compratore.
  const abilitati = new Set((buyerCorrieri || [])
    .filter((c: any) => c.attivo && (c.credenziali || {}).corriere_origine_id)
    .map((c: any) => (c.credenziali || {}).corriere_origine_id))

  const contratti = (miei || []).map((c: any) => ({
    id: c.id, nome_contratto: c.nome_contratto,
    tipo: isProviderTecnico(c.tipo) ? null : c.tipo,
    abilitato: abilitati.has(c.id),
  }))
  return NextResponse.json({ link: { id: link.id, compratore: buyer?.nome || '—' }, contratti })
}
