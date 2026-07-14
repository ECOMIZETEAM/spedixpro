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
  if (!M || ['cliente','agente'].includes((utente?.ruolo || '').toLowerCase())) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')   // 'YYYY-MM-DD'
  const alParam = req.nextUrl.searchParams.get('al')     // 'YYYY-MM-DD'
  // Intervallo: se arrivano dal/al (calendario) uso quelli, altrimenti il periodo predefinito.
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  // Aggregazione: per giorno se l'intervallo è breve, per mese se è lungo (o periodo annuale).
  const perMese = dalParam ? ((Date.parse(alEnd) - Date.parse(dal)) / 86400000 > 92) : (periodo === 'annuale')
  const admin = createAdminSupabase()
  const TIPI = ['spedizione', 'rimborso']

  // sotto-master diretti
  const { data: figli } = await admin.from('masters').select('id').eq('parent_master_id', M)
  const subIds = new Set((figli || []).map((f: any) => f.id))

  // movimenti sui libri del master M
  const { data: movM } = await admin.from('movimenti')
    .select('master_target_id,cliente_id,importo,tipo,created_at,spedizione_id')
    .eq('master_id', M).gte('created_at', dal).lte('created_at', alEnd).in('tipo', TIPI)

  // movimenti dei sotto-master diretti (per i loro pagamenti a cascata verso M)
  let movSub: any[] = []
  if (subIds.size) {
    const { data } = await admin.from('movimenti')
      .select('master_id,master_target_id,importo,tipo,created_at')
      .in('master_id', Array.from(subIds)).gte('created_at', dal).lte('created_at', alEnd).in('tipo', TIPI)
    movSub = data || []
  }

  const n = (x: any) => Number(x || 0)
  // Serie temporale: ricavi/costi per giorno (per mese/settimana/oggi) o per mese (annuale)
  const perGiorno = new Map<string, { ricavi: number; costi: number }>()
  const chiave = (iso: string) => perMese ? iso.slice(0, 7) : iso.slice(0, 10)  // YYYY-MM oppure YYYY-MM-DD
  const acc = (iso: string, campo: 'ricavi' | 'costi', v: number) => {
    const k = chiave(iso); const cur = perGiorno.get(k) || { ricavi: 0, costi: 0 }
    cur[campo] += v; perGiorno.set(k, cur)
  }

  let ricaviClienti = 0, costoM = 0, ricaviSub = 0
  for (const m of (movM || [])) {
    // addebito e rimborso si annullano da soli (storno esatto in annullo) -> annullate = netto 0
    if (m.cliente_id) { ricaviClienti += -n(m.importo); acc(m.created_at, 'ricavi', -n(m.importo)) }       // incasso dai clienti diretti
    else if (m.master_target_id === M) { costoM += -n(m.importo); acc(m.created_at, 'costi', -n(m.importo)) } // costo di M
  }
  for (const m of movSub) {
    if (m.master_id === m.master_target_id) { ricaviSub += -n(m.importo); acc(m.created_at, 'ricavi', -n(m.importo)) } // cascata sotto-master
  }

  const ricavi = Math.round((ricaviClienti + ricaviSub) * 100) / 100
  const costi = Math.round(costoM * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  // Numero di spedizioni del periodo (distinte) per la media per spedizione
  const spedSet = new Set<string>()
  for (const m of (movM || [])) if (m.tipo === 'spedizione' && m.spedizione_id) spedSet.add(m.spedizione_id)
  const numSpedizioni = spedSet.size
  const mediaSped = numSpedizioni > 0 ? Math.round((guadagno / numSpedizioni) * 100) / 100 : 0
  const r2 = (x: number) => Math.round(x * 100) / 100
  // Riempio TUTTI i punti dell'intervallo (0 dove non ci sono movimenti) così il grafico è continuo
  const startD = new Date(dal), endD = new Date(alEnd)
  const keys: string[] = []
  if (perMese) {
    let y = startD.getUTCFullYear(), m = startD.getUTCMonth()
    const ey = endD.getUTCFullYear(), em = endD.getUTCMonth()
    while (y < ey || (y === ey && m <= em)) {
      keys.push(`${y}-${String(m + 1).padStart(2, '0')}`)
      m++; if (m > 11) { m = 0; y++ }
    }
  } else {
    let t = Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth(), startD.getUTCDate())
    const endT = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate())
    while (t <= endT) { keys.push(new Date(t).toISOString().slice(0, 10)); t += 86400000 }
  }
  const serie = keys.map(k => {
    const v = perGiorno.get(k) || { ricavi: 0, costi: 0 }
    return { giorno: k, ricavi: r2(v.ricavi), costi: r2(v.costi), margine: r2(v.ricavi - v.costi) }
  })

  // ── SOLO per E&A MULTIEXPRESS: costo corriere diviso per provider (SpediamoPro / Spedisci.online).
  //    Serve a verificare 1=1 col credito speso su ciascun account. Non compare per gli altri master. ──
  const EA_MULTI_ID = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
  let costiProvider: any = null
  if (M === EA_MULTI_ID) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const sub = await sottoAlberoMasterIds(admin, M)
    const { data: sp } = await admin.from('spedizioni')
      .select('costo_spedizione, stato, corrieri(tipo)')
      .in('master_id', sub.length ? sub : [M])
      .gte('created_at', dal).lte('created_at', alEnd)
      .limit(20000)
    const agg = new Map<string, { costo: number; n: number }>()
    for (const s of (sp || [])) {
      // Escludo SOLO le 'annullata' (effettivamente cancellate + riaccreditate = netto 0).
      // Le 'annullamento_pending'/'annullamento_manuale' NON sono ancora annullate sul corriere
      // (nessun riaccredito): restano un COSTO reale e vanno contate.
      if ((s as any).stato === 'annullata') continue
      const tipo = (s as any).corrieri?.tipo || 'altro'
      const cur = agg.get(tipo) || { costo: 0, n: 0 }
      cur.costo += Number((s as any).costo_spedizione || 0); cur.n++
      agg.set(tipo, cur)
    }
    const LABEL: Record<string, string> = { spediamopro: 'SpediamoPro', spedisci: 'Spedisci.online' }
    costiProvider = Array.from(agg.entries())
      .map(([tipo, v]) => ({ provider: LABEL[tipo] || tipo, costo: r2(v.costo), n: v.n }))
      .sort((a, b) => b.costo - a.costo)
  }

  return NextResponse.json({ guadagno, ricavi, costi, periodo, serie, numSpedizioni, mediaSped, costiProvider })
}
