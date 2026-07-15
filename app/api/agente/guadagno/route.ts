import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { clientiAgente } from '@/lib/agente'
import { creaCalcolatoreListinoCliente } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'

// Guadagno dell'AGENTE = margine tra quello che paga il CLIENTE (costo_totale della spedizione)
// e il COSTO dell'agente (prezzo dal LISTINO AGENTE assegnato dal master), sulle spedizioni
// dei SOLI clienti dell'agente. Sola lettura.
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
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id,nome,cognome,listino_agente_id').eq('id', user.id).single()
  if ((u?.ruolo || '').toLowerCase() !== 'agente') return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')
  const alParam = req.nextUrl.searchParams.get('al')
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const perMese = dalParam ? ((Date.parse(alEnd) - Date.parse(dal)) / 86400000 > 92) : (periodo === 'annuale')

  const clienteIds = await clientiAgente(supabase, u as any)
  const listinoAg = (u as any)?.listino_agente_id || null
  if (!clienteIds.length || !listinoAg) {
    return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0, periodo, serie: [], numSpedizioni: 0, mediaSped: 0, senzaListino: !listinoAg })
  }

  // Spedizioni dei suoi clienti nel periodo (escluse le annullate).
  const speds = await fetchAll(() => supabase.from('spedizioni')
    .select('id,cliente_id,corriere_id,lunghezza,larghezza,altezza,peso_reale,dest_provincia,dest_cap,dest_paese,contrassegno,assicurazione,costo_totale,costo_spedizione,stato,created_at')
    .in('cliente_id', clienteIds)
    .gte('created_at', dal).lte('created_at', alEnd)
    .not('stato', 'in', '(annullata)')
    .order('created_at', { ascending: false }))

  const calcCosto = await creaCalcolatoreListinoCliente(supabase, listinoAg)

  const perGiorno = new Map<string, { ricavi: number; costi: number }>()
  const chiave = (iso: string) => perMese ? iso.slice(0, 7) : iso.slice(0, 10)
  const acc = (iso: string, campo: 'ricavi' | 'costi', v: number) => {
    const k = chiave(iso); const cur = perGiorno.get(k) || { ricavi: 0, costi: 0 }
    cur[campo] += v; perGiorno.set(k, cur)
  }

  let ricavi = 0, costi = 0
  for (const s of (speds || [])) {
    const ric = Number((s as any).costo_totale || 0)
    // Costo agente dal listino agente; se quel corriere non è nel listino, uso il costo reale
    // (costo_spedizione) invece di 0, altrimenti l'intero prezzo verrebbe contato come margine.
    const cAg = calcCosto(s)?.totale
    const cos = (cAg != null) ? cAg : Number((s as any).costo_spedizione || 0)
    ricavi += ric; costi += cos
    acc((s as any).created_at, 'ricavi', ric)
    acc((s as any).created_at, 'costi', cos)
  }
  const r2 = (x: number) => Math.round(x * 100) / 100
  ricavi = r2(ricavi); costi = r2(costi)
  const guadagno = r2(ricavi - costi)
  const numSpedizioni = (speds || []).length
  const mediaSped = numSpedizioni > 0 ? r2(guadagno / numSpedizioni) : 0

  // Serie continua (0 dove non ci sono dati)
  const startD = new Date(dal), endD = new Date(alEnd)
  const keys: string[] = []
  if (perMese) {
    let y = startD.getUTCFullYear(), m = startD.getUTCMonth()
    const ey = endD.getUTCFullYear(), em = endD.getUTCMonth()
    while (y < ey || (y === ey && m <= em)) { keys.push(`${y}-${String(m + 1).padStart(2, '0')}`); m++; if (m > 11) { m = 0; y++ } }
  } else {
    let t = Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth(), startD.getUTCDate())
    const endT = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate())
    while (t <= endT) { keys.push(new Date(t).toISOString().slice(0, 10)); t += 86400000 }
  }
  const serie = keys.map(k => {
    const v = perGiorno.get(k) || { ricavi: 0, costi: 0 }
    return { giorno: k, ricavi: r2(v.ricavi), costi: r2(v.costi), margine: r2(v.ricavi - v.costi) }
  })

  return NextResponse.json({ guadagno, ricavi, costi, periodo, serie, numSpedizioni, mediaSped })
}
