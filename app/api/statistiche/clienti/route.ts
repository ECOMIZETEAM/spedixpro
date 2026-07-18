import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// STATISTICHE — CLIENTI del master (sola lettura). Solo i PROPRI clienti diretti (analisi per cliente)
// + i sotto-master diretti come entità. Fatturato/profitto = margine del master su ciascuno.
const TIPI = ['spedizione', 'rimborso', 'rettifica']
const n = (x: any) => Number(x || 0)
const r2 = (x: number) => Math.round(x * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00Z').toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59Z').toISOString() : new Date().toISOString()
  const durata = Date.parse(alISO) - Date.parse(dalISO)
  const prevDal = new Date(Date.parse(dalISO) - durata).toISOString()
  const prevAl = dalISO

  const admin = createAdminSupabase()
  const { data: figli } = await admin.from('masters').select('id,nome').eq('parent_master_id', M)
  const subDiretti = new Map<string, string>((figli || []).map((f: any) => [f.id, f.nome]))
  const subIds = Array.from(subDiretti.keys())

  // Movimenti (per fatturato/costo/profitto per entità)
  const movM = await fetchAll(() => admin.from('movimenti').select('cliente_id,master_target_id,importo,tipo,spedizione_id,created_at')
    .eq('master_id', M).not('spedizione_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO).in('tipo', TIPI).order('created_at', { ascending: false }))
  let movSub: any[] = []
  if (subIds.length) movSub = await fetchAll(() => admin.from('movimenti').select('master_id,master_target_id,importo,spedizione_id')
    .in('master_id', subIds).not('spedizione_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO).in('tipo', TIPI))

  const ricavoCli = new Map<string, number>(), costoSped = new Map<string, number>(), cliDiSped = new Map<string, string>()
  for (const m of movM) {
    const sid = (m as any).spedizione_id
    if (m.cliente_id) { const v = -n(m.importo); ricavoCli.set(m.cliente_id, (ricavoCli.get(m.cliente_id) || 0) + v); if (sid) cliDiSped.set(sid, m.cliente_id) }
    else if (m.master_target_id === M && sid) costoSped.set(sid, (costoSped.get(sid) || 0) + (-n(m.importo)))
  }
  const ricavoSub = new Map<string, number>()
  for (const m of movSub) if (m.master_id === m.master_target_id) ricavoSub.set(m.master_id, (ricavoSub.get(m.master_id) || 0) + (-n(m.importo)))
  const costoPerCli = new Map<string, number>()
  for (const [sid, c] of costoSped) { const cli = cliDiSped.get(sid); if (cli) costoPerCli.set(cli, (costoPerCli.get(cli) || 0) + c) }

  // Spedizioni dei clienti diretti (resi/contrassegno/ultima) — solo master_id = M
  const cliIds = Array.from(ricavoCli.keys())
  const sped = cliIds.length ? await fetchAll(() => admin.from('spedizioni').select('cliente_id,stato,contrassegno,created_at')
    .eq('master_id', M).not('cliente_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO)
    .order('created_at', { ascending: false })) : []
  const perCli = new Map<string, { resi: number; cod: number; ultima: string }>()
  for (const s of sped) {
    const cid = (s as any).cliente_id; if (!cid) continue
    const cur = perCli.get(cid) || { resi: 0, cod: 0, ultima: '' }
    if ((s as any).stato === 'reso_mittente') cur.resi++
    cur.cod += n((s as any).contrassegno)
    if (!cur.ultima || (s as any).created_at > cur.ultima) cur.ultima = (s as any).created_at
    perCli.set(cid, cur)
  }

  // Nomi clienti
  const nomiCli = new Map<string, string>()
  if (cliIds.length) { const { data: cs } = await admin.from('clienti').select('id,ragione_sociale').in('id', cliIds); for (const c of (cs || [])) nomiCli.set((c as any).id, (c as any).ragione_sociale) }

  const righe = cliIds.map(cid => {
    const fatt = ricavoCli.get(cid) || 0, cost = costoPerCli.get(cid) || 0, extra = perCli.get(cid) || { resi: 0, cod: 0, ultima: '' }
    return { nome: nomiCli.get(cid) || 'Cliente', spedizioni: 0, fatturato: r2(fatt), costo: r2(cost), profitto: r2(fatt - cost),
      margine: fatt > 0 ? r2(((fatt - cost) / fatt) * 100) : 0, resi: extra.resi, contrassegno: r2(extra.cod), ultima: extra.ultima ? extra.ultima.slice(0, 10) : '' }
  })
  // n spedizioni per cliente diretto
  const nSpedCli = new Map<string, number>()
  for (const [, cid] of cliDiSped) nSpedCli.set(cid, (nSpedCli.get(cid) || 0) + 1)
  for (const r of righe) { const cid = cliIds.find(id => (nomiCli.get(id) || 'Cliente') === r.nome); if (cid) r.spedizioni = nSpedCli.get(cid) || 0 }
  // sotto-master come entità
  for (const [smid, fatt] of ricavoSub) righe.push({ nome: (subDiretti.get(smid) || 'Sotto-master') + ' (rete)', spedizioni: 0, fatturato: r2(fatt), costo: 0, profitto: r2(fatt), margine: 100, resi: 0, contrassegno: 0, ultima: '' })

  const clientiAttivi = righe.length
  const fatturatoTot = r2(righe.reduce((a, r) => a + r.fatturato, 0))
  const profittoTot = r2(righe.reduce((a, r) => a + r.profitto, 0))
  const fatturatoMedio = clientiAttivi ? r2(fatturatoTot / clientiAttivi) : 0
  const profittoMedio = clientiAttivi ? r2(profittoTot / clientiAttivi) : 0

  // Fatturato periodo precedente per cliente (crescita) + rischio abbandono
  const movPrev = await fetchAll(() => admin.from('movimenti').select('cliente_id,importo').eq('master_id', M)
    .not('cliente_id', 'is', null).not('spedizione_id', 'is', null).gte('created_at', prevDal).lte('created_at', prevAl).in('tipo', TIPI))
  const ricavoPrev = new Map<string, number>()
  for (const m of movPrev) ricavoPrev.set(m.cliente_id, (ricavoPrev.get(m.cliente_id) || 0) + (-n(m.importo)))
  const crescita = cliIds.map(cid => ({ nome: nomiCli.get(cid) || 'Cliente', precedente: r2(ricavoPrev.get(cid) || 0), attuale: r2(ricavoCli.get(cid) || 0), variazione: r2((ricavoCli.get(cid) || 0) - (ricavoPrev.get(cid) || 0)) }))
    .filter(c => c.variazione > 0).sort((a, b) => b.variazione - a.variazione).slice(0, 10)
  const rischio = Array.from(ricavoPrev.entries()).filter(([cid]) => !ricavoCli.has(cid))
    .map(([cid, fatt]) => ({ nome: nomiCli.get(cid) || 'Cliente', fatturatoPrec: r2(fatt) })).sort((a, b) => b.fatturatoPrec - a.fatturatoPrec).slice(0, 10)

  return NextResponse.json({
    kpi: { clientiAttivi, fatturatoMedio, profittoMedio, valoreDaFatturare: fatturatoTot },
    righe: righe.sort((a, b) => b.fatturato - a.fatturato),
    topFatturato: [...righe].sort((a, b) => b.fatturato - a.fatturato).slice(0, 12),
    topProfitto: [...righe].sort((a, b) => b.profitto - a.profitto).slice(0, 12),
    crescita, rischio,
  })
}
