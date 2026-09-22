import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Guadagno supplementi (giacenze, riconsegne, ecc.). Incasso = cio' che addebito io (a clienti e
// sotto-master) + cio' che mi pagano i sotto-master col loro movimento proprio; costo = cio' che
// addebitano a me. Scartare una voce della stessa spedizione perdeva soldi veri (apertura dossier +
// riconsegna/reso, quest'ultima anche a 0 per tracciabilita'), quindi si sommano tutte.
function dataDa(periodo: string): string {
  const d = new Date()
  if (periodo === 'giornaliero') d.setHours(0, 0, 0, 0)
  else if (periodo === 'settimanale') { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0) }
  else if (periodo === 'annuale') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }
  else { d.setDate(1); d.setHours(0, 0, 0, 0) }
  return d.toISOString()
}


export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || ['cliente','agente'].includes((utente?.ruolo || '').toLowerCase())) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')   // 'YYYY-MM-DD'
  const alParam = req.nextUrl.searchParams.get('al')     // 'YYYY-MM-DD'
  // Calendario come Guadagno e Rettifiche: dal/al se arrivano, altrimenti il periodo predefinito.
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const admin = createAdminSupabase()

  // I supplementi stanno in 'movimenti' (prima si leggeva 'movimenti_clienti', un registro parallelo
  // mai popolato: il report dava SEMPRE zero). Riconosciuti dalla descrizione (giacenza, riconsegna,
  // supplemento). NIENTE dedup per LDV: la stessa spedizione ha PIU' voci distinte e reali.
  // Aggregazione nel DB (guadagno_supplementi_v1), con la regola degli altri riquadri: conta anche
  // quello che pagano i SOTTO-MASTER col loro movimento proprio — prima mancava, e MULTIEXPRESS a
  // settembre risultava -791 invece di +481 — e gli storni col loro segno (prima il valore assoluto
  // li faceva diventare addebiti).
  const { data: agg, error } = await admin.rpc('guadagno_supplementi_v1', { p_master: M, p_dal: dal, p_al: alEnd })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const row: any = Array.isArray(agg) ? (agg[0] || {}) : (agg || {})
  const ricavi = Math.round(Number(row.ricavi || 0) * 100) / 100
  const costi = Math.round(Number(row.costi || 0) * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
