import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// Guadagno supplementi (giacenze, riconsegne, ecc.): legge 'movimenti' filtrata per quei nomi.
// Incasso = cio' che addebito io (master_id = io), costo = cio' che addebitano a me
// (master_target_id = io); l'importo e' sempre negativo perche' l'addebito scala il credito.
// NIENTE dedup per LDV: la stessa spedizione ha PIU' voci distinte e reali (apertura dossier +
// riconsegna/reso, quest'ultima anche a 0 per tracciabilita'). Scartarne una perdeva soldi veri
// e il risultato dipendeva pure dall'ordine con cui tornavano le righe.
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
  const dal = dataDa(periodo)
  const admin = createAdminSupabase()

  // I supplementi stanno in 'movimenti': prima si leggeva 'movimenti_clienti', un registro
  // parallelo mai popolato, quindi il report dava SEMPRE zero. Qui il segno è sempre negativo
  // (l'addebito scala il credito): quello che incasso è ciò che addebito IO (master_id = io),
  // quello che pago è ciò che addebitano A ME (master_target_id = io).
  const SUPPL = 'descrizione.ilike.%giacenz%,descrizione.ilike.%riconsegn%,descrizione.ilike.%supplement%'
  const query = (col: string) => admin.from('movimenti')
    .select('descrizione,importo,created_at,master_id,master_target_id')
    .eq(col, M).gte('created_at', dal).or(SUPPL).order('id', { ascending: true })
  // fetchAll: su un anno di supplementi si supera il taglio silenzioso a 1000 righe.
  const [movRicavi, movCosti] = await Promise.all([
    fetchAll(() => query('master_id')), fetchAll(() => query('master_target_id')),
  ])

  // Ogni riga di 'movimenti' e' un addebito distinto e gia' unico: si sommano tutte.
  const somma = (righe: any[]) =>
    (righe || []).reduce((t: number, r: any) => t + Math.abs(Number(r.importo || 0)), 0)
  // Un addebito che faccio a me stesso non è un ricavo: conta solo come costo.
  let ricavi = somma((movRicavi || []).filter((r: any) => r.master_target_id !== M))
  let costi = somma(movCosti || [])

  ricavi = Math.round(ricavi * 100) / 100
  costi = Math.round(costi * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
