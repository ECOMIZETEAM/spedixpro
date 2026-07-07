import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Guadagno del master = quanto incassa dai clienti diretti e dai sotto-master diretti
// per le SPEDIZIONI, meno quanto il master paga al livello superiore/corriere.
// (Solo spedizioni + eventuali rimborsi per non contare le annullate. Resi esclusi.)
function dataDa(periodo: string): string {
  const d = new Date()
  if (periodo === 'giornaliero') d.setHours(0, 0, 0, 0)
  else if (periodo === 'settimanale') { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0) }
  else if (periodo === 'annuale') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }
  else { d.setDate(1); d.setHours(0, 0, 0, 0) }  // mensile: dal 1° del mese
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || (utente?.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dal = dataDa(periodo)
  const admin = createAdminSupabase()
  const TIPI = ['spedizione', 'rimborso']

  // sotto-master diretti
  const { data: figli } = await admin.from('masters').select('id').eq('parent_master_id', M)
  const subIds = new Set((figli || []).map((f: any) => f.id))

  // movimenti sui libri del master M
  const { data: movM } = await admin.from('movimenti')
    .select('master_target_id,cliente_id,importo,tipo')
    .eq('master_id', M).gte('created_at', dal).in('tipo', TIPI)

  // movimenti dei sotto-master diretti (per i loro pagamenti a cascata verso M)
  let movSub: any[] = []
  if (subIds.size) {
    const { data } = await admin.from('movimenti')
      .select('master_id,master_target_id,importo,tipo')
      .in('master_id', Array.from(subIds)).gte('created_at', dal).in('tipo', TIPI)
    movSub = data || []
  }

  const n = (x: any) => Number(x || 0)
  let ricaviClienti = 0, costoM = 0, ricaviSub = 0
  for (const m of (movM || [])) {
    if (m.cliente_id) ricaviClienti += -n(m.importo)            // incasso dai clienti diretti (addebito negativo -> ricavo)
    else if (m.master_target_id === M) costoM += -n(m.importo)  // costo di M verso il livello superiore/corriere
  }
  for (const m of movSub) {
    if (m.master_id === m.master_target_id) ricaviSub += -n(m.importo)  // pagamento cascata del sotto-master verso M
  }

  const ricavi = Math.round((ricaviClienti + ricaviSub) * 100) / 100
  const costi = Math.round(costoM * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
