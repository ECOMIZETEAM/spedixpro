import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Guadagno sulle RIPESATURE (rettifiche peso/misure) del master.
//
// Prima questo report RICALCOLAVA il margine dai listini: per ogni rettifica ri-prezzava il listino
// cliente e il costo corriere al peso vecchio e a quello nuovo e ne faceva la differenza. Due problemi:
//  1) e' il margine TEORICO del listino di oggi, non i soldi VERI addebitati (che restano nei movimenti
//     al momento della rettifica: se un listino cambia, o la rettifica ha riaddebitato a un sotto-master,
//     il ricalcolo divergeva);
//  2) chi rivende a SOTTO-MASTER (es. MULTIEXPRESS) non ha listino_cliente sulla rettifica, quindi il
//     ricavo del riaddebito al sotto-master cadeva fuori e il report restava fermo.
// Ora il margine lo aggrega il DB dai MOVIMENTI di tipo 'rettifica' (RPC guadagno_rettifiche_v1), con la
// stessa struttura del Report Guadagno (movimento cliente/sotto-master = ricavo, movimento master_target
// = costo, incluso il costo che scende dal livello superiore), ristretta alle sole ripesature: i due
// report combaciano e i sotto-master rientrano nel conto. Prima si scaricavano in memoria TUTTE le
// rettifiche del mese, mille alla volta (per MULTIEXPRESS ~17.000 righe = ~18 round-trip): ora una sola.
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
  // Se arriva dal/al (calendario) uso quelli, altrimenti il periodo predefinito. Il limite superiore
  // (prima mancante: si sommava da 'dal' all'infinito) chiude la finestra a fine intervallo / adesso.
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const admin = createAdminSupabase()

  const { data: agg, error } = await admin.rpc('guadagno_rettifiche_v1', { p_master: M, p_dal: dal, p_al: alEnd })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const row: any = Array.isArray(agg) ? (agg[0] || {}) : (agg || {})
  const ricavi = Math.round(Number(row.ricavi || 0) * 100) / 100
  const costi = Math.round(Number(row.costi || 0) * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
