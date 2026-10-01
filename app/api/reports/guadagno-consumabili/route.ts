import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Guadagno CONSUMABILI del master — riquadro a sé in home, come Rettifiche/Resi/Giacenze/Logistica.
// I consumabili (buste, materiali addebitati fuori dalla spedizione, via la funzione Consumabili) sono
// movimenti di tipo 'consumabile' SENZA spedizione_id (prima erano salvati come 'rettifica' generica,
// mischiati con gli aggiustamenti manuali: ora hanno un tipo loro). Non passano da guadagno_master_serie_v1
// (che richiede spedizione_id): qui il margine è diretto —
//   ricavo = quello che il master ADDEBITA (ai suoi clienti o sotto-master): master_id = M
//   costo  = quello che il master si vede addebitare dal proprio parent: master_target = M (da altri)
// Rientra anche nel Guadagno Totale (calderone). La card è a 0 finché qualcuno non carica consumabili.
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
  const dalParam = req.nextUrl.searchParams.get('dal')
  const alParam = req.nextUrl.searchParams.get('al')
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const admin = createAdminSupabase()
  const r2 = (x: number) => Math.round(x * 100) / 100

  const [inc, cost] = await Promise.all([
    admin.from('movimenti').select('importo').eq('tipo', 'consumabile').eq('master_id', M).gte('created_at', dal).lte('created_at', alEnd),
    admin.from('movimenti').select('importo').eq('tipo', 'consumabile').eq('master_target_id', M).neq('master_id', M).gte('created_at', dal).lte('created_at', alEnd),
  ])
  if (inc.error) return NextResponse.json({ error: inc.error.message }, { status: 500 })
  if (cost.error) return NextResponse.json({ error: cost.error.message }, { status: 500 })
  const ricavi = r2((inc.data || []).reduce((s: number, x: any) => s + (-(Number(x.importo || 0))), 0))
  const costi = r2((cost.data || []).reduce((s: number, x: any) => s + (-(Number(x.importo || 0))), 0))
  return NextResponse.json({ guadagno: r2(ricavi - costi), ricavi, costi, periodo })
}
