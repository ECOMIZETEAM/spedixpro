import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Guadagno sulle GIACENZE del master — riquadro a sé in home, come Rettifiche, Supplementi e Resi.
//
// Come per i Resi: prima le giacenze erano dentro "Guadagno Spedizioni" e ne falsavano margine e media
// (che divide per le sole spedizioni). Ora stanno qui, col loro calendario. Il margine lo aggrega il DB
// dai MOVIMENTI di tipo 'giacenza' con la stessa struttura del Report Guadagno (cliente/sotto-master =
// ricavo, master_target = costo, col costo che scende dal livello superiore), tramite la stessa RPC
// `guadagno_master_serie_v1` ristretta a tipo 'giacenza'.
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
  if (!M || ['cliente', 'agente'].includes((utente?.ruolo || '').toLowerCase())) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')   // 'YYYY-MM-DD'
  const alParam = req.nextUrl.searchParams.get('al')     // 'YYYY-MM-DD'
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const perMese = (Date.parse(alEnd) - Date.parse(dal)) / 86400000 > 92
  const admin = createAdminSupabase()

  const { data: serie, error } = await admin.rpc('guadagno_master_serie_v1', { p_master: M, p_dal: dal, p_al: alEnd, p_per_mese: perMese, p_tipi: ['giacenza'] })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let ricaviTot = 0, costiTot = 0
  for (const row of (serie || [])) { ricaviTot += Number((row as any).ricavi || 0); costiTot += Number((row as any).costi || 0) }
  const r2 = (x: number) => Math.round(x * 100) / 100
  const ricavi = r2(ricaviTot)
  const costi = r2(costiTot)
  return NextResponse.json({ guadagno: r2(ricavi - costi), ricavi, costi, periodo })
}
