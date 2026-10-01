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

  const [{ data: buyer }, { data: miei }, { data: buyerMoov }, { data: buyerPropri }] = await Promise.all([
    admin.from('masters').select('nome').eq('id', link.master_id).maybeSingle(),
    // TUTTI i miei contratti attivi (anche moovexpress: un contratto comprato da un ALTRO master — es.
    // la Triangolazioni presa da LOGIXIA — è proprio quello che rivendo al collegato, la catena a 3 livelli).
    admin.from('corrieri').select('id,nome_contratto,tipo,credenziali').eq('master_id', perm.masterId).eq('attivo', true).order('nome_contratto'),
    // I moovexpress del compratore (per sapere cosa gli ho GIÀ abilitato: corriere_origine_id → mio corriere).
    admin.from('corrieri').select('id,credenziali,attivo').eq('master_id', link.master_id).eq('tipo', 'moovexpress'),
    // I contratti PROPRI del compratore (non-moovexpress), ATTIVI O NO: quelli che LUI già ha — non glieli
    // rivendo. Essendo io un suo sotto-master, i miei contratti a cascata hanno il SUO stesso nome → spariscono
    // (era il bug "gli rivende i suoi contratti"). Anche i suoi DISATTIVATI restano suoi (FedEx/CRONO ecc. erano
    // attivo=false su di lui ma attivi come copia su di me → vanno comunque esclusi). Resta solo ciò che è
    // davvero mio da vendergli (la Triangolazioni di LOGIXIA, o un mio contratto che lui non ha proprio).
    admin.from('corrieri').select('nome_contratto').eq('master_id', link.master_id).neq('tipo', 'moovexpress'),
  ])
  const abilitati = new Set((buyerMoov || [])
    .filter((c: any) => c.attivo && (c.credenziali || {}).corriere_origine_id)
    .map((c: any) => (c.credenziali || {}).corriere_origine_id))
  const giaSuoi = new Set((buyerPropri || []).map((c: any) => (c.nome_contratto || '').trim().toLowerCase()))

  const contratti = (miei || [])
    .filter((c: any) => {
      // già suo (per nome) → no. moovexpress che VIENE da lui → no (non si rivende all'origine).
      if (giaSuoi.has((c.nome_contratto || '').trim().toLowerCase())) return false
      if (c.tipo === 'moovexpress' && (c.credenziali || {}).fornitore_master_id === link.master_id) return false
      return true
    })
    .map((c: any) => ({
      id: c.id, nome_contratto: c.nome_contratto,
      tipo: isProviderTecnico(c.tipo) ? null : c.tipo,
      abilitato: abilitati.has(c.id),
    }))
  return NextResponse.json({ link: { id: link.id, compratore: buyer?.nome || '—' }, contratti })
}
