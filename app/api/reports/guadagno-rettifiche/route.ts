import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// Guadagno sulle RIPESATURE (rettifiche peso/misure) del master.
//
// Prima questo report RICALCOLAVA il margine dai listini: per ogni rettifica ri-prezzava il listino
// cliente e il costo corriere al peso vecchio e a quello nuovo e ne faceva la differenza. Due problemi:
//  1) e' il margine TEORICO del listino di oggi, non i soldi VERI addebitati (che restano nei movimenti
//     al momento della rettifica: se un listino cambia, o la rettifica ha riaddebitato a un sotto-master,
//     il ricalcolo divergeva);
//  2) chi rivende a SOTTO-MASTER (es. MULTIEXPRESS) non ha listino_cliente sulla rettifica, quindi il
//     ricavo del riaddebito al sotto-master cadeva fuori e il report restava fermo.
// Ora legge il margine dai MOVIMENTI di tipo 'rettifica', con la stessa struttura del Report Guadagno
// (movimento cliente = ricavo, movimento master_target = costo), ristretta alle sole rettifiche. Cosi'
// i due report combaciano e i sotto-master rientrano nel conto.
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
  const TIPI = ['rettifica']   // SOLO le ripesature
  const admin = createAdminSupabase()

  // sotto-master diretti
  const { data: figli } = await admin.from('masters').select('id').eq('parent_master_id', M)
  const subIds = new Set((figli || []).map((f: any) => f.id))

  // Movimenti di rettifica sui libri del master M, legati a una spedizione (fetchAll: senza range
  // PostgREST taglierebbe a 1000 e i totali sarebbero sbagliati).
  const movM = await fetchAll(() => admin.from('movimenti')
    .select('master_target_id,cliente_id,importo,tipo,created_at,spedizione_id')
    .eq('master_id', M).not('spedizione_id', 'is', null).gte('created_at', dal).lte('created_at', alEnd).in('tipo', TIPI)
    .order('created_at', { ascending: false }).order('id', { ascending: false }))

  // Movimenti dei sotto-master diretti (le loro rettifiche a cascata che risalgono a M).
  let movSub: any[] = []
  if (subIds.size) {
    movSub = await fetchAll(() => admin.from('movimenti')
      .select('master_id,master_target_id,importo,tipo,created_at,spedizione_id')
      .in('master_id', Array.from(subIds)).not('spedizione_id', 'is', null).gte('created_at', dal).lte('created_at', alEnd).in('tipo', TIPI)
      .order('created_at', { ascending: false }).order('id', { ascending: false }))
  }
  // Anti doppio conteggio (spedizione, sotto-master, tipo): una rettifica riaddebitata al sotto-master
  // puo' comparire SIA come SELF del figlio (in movSub) SIA come mio addebito diretto (master_id=M,
  // target=figlio). La chiave col tipo tiene una sola strada.
  const selfSubKeys = new Set<string>()
  for (const m of movSub) if (m.master_id === m.master_target_id && (m as any).spedizione_id) selfSubKeys.add((m as any).spedizione_id + '|' + m.master_id + '|' + m.tipo)

  const n = (x: any) => Number(x || 0)

  // Spedizioni proprie del master (master_id=M, senza cliente): la rettifica sulla propria conta SIA
  // come costo SIA come ricavo pari → margine 0 (paga a se stesso), come nel Report Guadagno.
  const idsDaLeggere = Array.from(new Set((movM || []).filter((m: any) => m.spedizione_id).map((m: any) => m.spedizione_id)))
  const propriaSet = new Set<string>()
  for (let i = 0; i < idsDaLeggere.length; i += 300) {
    const { data: sps } = await admin.from('spedizioni').select('id,master_id,cliente_id').in('id', idsDaLeggere.slice(i, i + 300))
    for (const sp of (sps || [])) { const s: any = sp; if (s.master_id === M && !s.cliente_id) propriaSet.add(s.id) }
  }

  let ricaviClienti = 0, costoM = 0, ricaviSub = 0, ricaviPropria = 0
  for (const m of (movM || [])) {
    if (m.cliente_id) { ricaviClienti += -n(m.importo) }                                     // extra addebitato ai clienti diretti
    else if (m.master_target_id === M) {
      const v = -n(m.importo)
      costoM += v                                                                             // extra pagato da M (self / al corriere)
      if ((m as any).spedizione_id && propriaSet.has((m as any).spedizione_id)) ricaviPropria += v   // propria: margine 0
    }
    // Ricavo da un SOTTO-MASTER diretto riaddebitato sui MIEI libri (chi rivende a sotto-master).
    else if (m.master_target_id && subIds.has(m.master_target_id)
             && !selfSubKeys.has((m as any).spedizione_id + '|' + m.master_target_id + '|' + m.tipo)) {
      ricaviSub += -n(m.importo)
    }
  }
  for (const m of movSub) {
    if (m.master_id === m.master_target_id) ricaviSub += -n(m.importo)   // cascata: self del sotto-master = mio ricavo
  }

  // COSTO addebitato dal LIVELLO SUPERIORE: la ripesatura che il PADRE addebita a M ha master_id=PADRE,
  // target=M → non e' in movM (filtra master_id=M). Senza questo il costo della rettifica non veniva
  // contato e il margine usciva gonfiato. master_id≠M esclude i self gia' contati sopra.
  const movCostoSopra = await fetchAll(() => admin.from('movimenti')
    .select('importo,tipo,created_at,spedizione_id')
    .eq('master_target_id', M).neq('master_id', M).not('spedizione_id', 'is', null)
    .gte('created_at', dal).lte('created_at', alEnd).in('tipo', TIPI)
    .order('created_at', { ascending: false }).order('id', { ascending: false }))
  for (const m of movCostoSopra) costoM += -n(m.importo)

  const ricavi = Math.round((ricaviClienti + ricaviSub + ricaviPropria) * 100) / 100
  const costi = Math.round(costoM * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
