import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { fetchAll } from '@/lib/fetch-all'

// STATISTICHE — PROFITTO del master (sola lettura). Scope "le solite": solo i PROPRI clienti e i
// PROPRI sotto-master diretti (+ cascata per il volume). Il profitto è il MARGINE del master:
//   fatturato = quello che ha addebitato ai clienti diretti + sotto-master diretti
//   costo     = quello che ha pagato lui (verso il livello superiore / corriere)
//   profitto  = fatturato - costo
// Include spedizioni + rettifiche + RESI + GIACENZE (margine totale), coerente col Report Guadagno.
const TIPI = ['spedizione', 'rimborso', 'rettifica', 'reso', 'giacenza']
const n = (x: any) => Number(x || 0)
const r2 = (x: number) => Math.round(x * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  // Agenti e clienti NON vedono le statistiche del master.
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) {
    return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })
  }

  const dal = (req.nextUrl.searchParams.get('dal') || '') + 'T00:00:00.000Z'
  const al = (req.nextUrl.searchParams.get('al') || req.nextUrl.searchParams.get('dal') || '') + 'T23:59:59.999Z'
  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(dal).toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(al).toISOString() : new Date().toISOString()

  const admin = createAdminSupabase()
  const { data: figli } = await admin.from('masters').select('id,nome').eq('parent_master_id', M)
  const subDiretti = new Map<string, string>((figli || []).map((f: any) => [f.id, f.nome]))
  const subIds = Array.from(subDiretti.keys())

  // Movimenti sui libri di M (ricavi da clienti diretti + costo di M)
  // SOLO movimenti legati a una spedizione (esclude aggiustamenti manuali di saldo) → coerente con l'Elenco.
  const movM = await fetchAll(() => admin.from('movimenti')
    .select('cliente_id,master_target_id,importo,tipo,created_at,spedizione_id')
    .eq('master_id', M).not('spedizione_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO).in('tipo', TIPI)
    .order('created_at', { ascending: false }))
  // Movimenti dei sotto-master diretti (loro costo verso M = ricavo di M dai sotto-master)
  let movSub: any[] = []
  if (subIds.length) {
    movSub = await fetchAll(() => admin.from('movimenti')
      .select('master_id,master_target_id,importo,tipo,created_at,spedizione_id')
      .in('master_id', subIds).not('spedizione_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO).in('tipo', TIPI)
      .order('created_at', { ascending: false }))
  }

  // Aggregazioni per spedizione (costo/ricavo del master) + per cliente + serie
  const costoSped = new Map<string, number>()   // costo di M per spedizione
  const ricavoSped = new Map<string, number>()  // ricavo di M per spedizione
  const ricavoCliente = new Map<string, number>()
  const ricavoSub = new Map<string, number>()
  const perGiorno = new Map<string, { fatturato: number; costo: number }>()
  const day = (iso: string) => iso.slice(0, 10)
  const accG = (iso: string, campo: 'fatturato' | 'costo', v: number) => {
    const k = day(iso); const cur = perGiorno.get(k) || { fatturato: 0, costo: 0 }; cur[campo] += v; perGiorno.set(k, cur)
  }

  // Spedizioni PROPRIE (master senza cliente): contano entrata = uscita → margine 0 (come nel Report Guadagno).
  const costSpedIds = Array.from(new Set(movM.filter((m: any) => !m.cliente_id && m.master_target_id === M && m.spedizione_id).map((m: any) => m.spedizione_id)))
  const propriaSet = new Set<string>()
  for (let i = 0; i < costSpedIds.length; i += 300) {
    const chunk = costSpedIds.slice(i, i + 300)
    const { data: sps } = await admin.from('spedizioni').select('id,master_id,cliente_id').in('id', chunk)
    for (const sp of (sps || [])) if ((sp as any).master_id === M && !(sp as any).cliente_id) propriaSet.add((sp as any).id)
  }

  for (const m of movM) {
    const sid = (m as any).spedizione_id
    if (m.cliente_id) {
      const v = -n(m.importo)
      ricavoCliente.set(m.cliente_id, (ricavoCliente.get(m.cliente_id) || 0) + v)
      if (sid) ricavoSped.set(sid, (ricavoSped.get(sid) || 0) + v)
      accG(m.created_at, 'fatturato', v)
    } else if (m.master_target_id === M) {
      const v = -n(m.importo)
      if (sid) costoSped.set(sid, (costoSped.get(sid) || 0) + v)
      accG(m.created_at, 'costo', v)
      // Propria: ricavo = costo → margine 0 (non riduce il profitto).
      if (sid && propriaSet.has(sid)) { ricavoSped.set(sid, (ricavoSped.get(sid) || 0) + v); accG(m.created_at, 'fatturato', v) }
    }
  }
  for (const m of movSub) {
    if (m.master_id === m.master_target_id) {
      const v = -n(m.importo); const sid = (m as any).spedizione_id
      ricavoSub.set(m.master_id, (ricavoSub.get(m.master_id) || 0) + v)
      if (sid) ricavoSped.set(sid, (ricavoSped.get(sid) || 0) + v)
      accG(m.created_at, 'fatturato', v)
    }
  }

  const fatturato = r2(Array.from(ricavoSped.values()).reduce((a, b) => a + b, 0))
  const costo = r2(Array.from(costoSped.values()).reduce((a, b) => a + b, 0))
  const profitto = r2(fatturato - costo)
  const sids = new Set<string>([...costoSped.keys(), ...ricavoSped.keys()])
  const nSped = sids.size
  const margine = fatturato > 0 ? r2((profitto / fatturato) * 100) : 0
  const costoMedio = nSped > 0 ? r2(costo / nSped) : 0
  const profittoMedio = nSped > 0 ? r2(profitto / nSped) : 0

  // Corriere + cliente per spedizione (per i breakdown). Solo le spedizioni coinvolte.
  const sidArr = Array.from(sids)
  const corrDiSped = new Map<string, string>()
  const cliDiSped = new Map<string, string | null>()
  let costoMax = 0, costoMaxLdv = '', costoMaxCliente = ''
  const perCorr = new Map<string, { sped: number; fatt: number; costo: number }>()
  if (sidArr.length) {
    for (let i = 0; i < sidArr.length; i += 300) {
      const chunk = sidArr.slice(i, i + 300)
      const { data: sp } = await admin.from('spedizioni')
        .select('id,numero,cliente_id,clienti(ragione_sociale),corrieri(nome_contratto)').in('id', chunk)
      for (const s of (sp || [])) {
        const sid = (s as any).id
        const corr = (s as any).corrieri?.nome_contratto || '—'
        corrDiSped.set(sid, corr)
        cliDiSped.set(sid, (s as any).clienti?.ragione_sociale || null)
        const c = costoSped.get(sid) || 0, f = ricavoSped.get(sid) || 0
        const cur = perCorr.get(corr) || { sped: 0, fatt: 0, costo: 0 }
        cur.sped++; cur.fatt += f; cur.costo += c; perCorr.set(corr, cur)
        if (c > costoMax) { costoMax = c; costoMaxLdv = (s as any).numero || ''; costoMaxCliente = (s as any).clienti?.ragione_sociale || '' }
      }
    }
  }

  const perCorriere = Array.from(perCorr.entries()).map(([corriere, v]) => ({
    corriere, spedizioni: v.sped, fatturato: r2(v.fatt), costo: r2(v.costo),
    profitto: r2(v.fatt - v.costo), margine: v.fatt > 0 ? r2(((v.fatt - v.costo) / v.fatt) * 100) : 0,
    costoMedio: v.sped > 0 ? r2(v.costo / v.sped) : 0,
  })).sort((a, b) => b.profitto - a.profitto)

  // Top clienti (clienti diretti + sotto-master diretti come "clienti" del master)
  const nomiCli = new Map<string, string>()
  const cliIds = Array.from(ricavoCliente.keys())
  if (cliIds.length) {
    const { data: cs } = await admin.from('clienti').select('id,ragione_sociale').in('id', cliIds)
    for (const c of (cs || [])) nomiCli.set((c as any).id, (c as any).ragione_sociale)
  }
  const entita: { nome: string; fatturato: number; profitto: number }[] = []
  // Per i clienti diretti servono anche i loro costi-di-M per il profitto: costoSped delle loro spedizioni.
  // Approssimo il profitto per entità come fatturato - costo attribuito (dai movimenti costoSped via cliDiSped).
  const costoPerCliente = new Map<string, number>()
  for (const [sid, c] of costoSped) { const cli = cliDiSped.get(sid); if (cli) costoPerCliente.set(cli, (costoPerCliente.get(cli) || 0) + c) }
  for (const [cid, fatt] of ricavoCliente) {
    const nome = nomiCli.get(cid) || 'Cliente'
    const cost = costoPerCliente.get(nome) || 0
    entita.push({ nome, fatturato: r2(fatt), profitto: r2(fatt - cost) })
  }
  for (const [smid, fatt] of ricavoSub) {
    // profitto dal sotto-master = suo fatturato verso M - costo di M per le sue spedizioni (approx via serie non separata) → mostro fatturato, profitto ≈ margine su di lui
    entita.push({ nome: (subDiretti.get(smid) || 'Sotto-master') + ' (rete)', fatturato: r2(fatt), profitto: r2(fatt) })
  }
  const topFatturato = [...entita].sort((a, b) => b.fatturato - a.fatturato).slice(0, 12)
  const topProfitto = [...entita].sort((a, b) => b.profitto - a.profitto).slice(0, 12)

  // Serie temporale continua (0 dove non ci sono dati)
  const keys: string[] = []
  let t = Date.UTC(new Date(dalISO).getUTCFullYear(), new Date(dalISO).getUTCMonth(), new Date(dalISO).getUTCDate())
  const endT = Date.UTC(new Date(alISO).getUTCFullYear(), new Date(alISO).getUTCMonth(), new Date(alISO).getUTCDate())
  while (t <= endT) { keys.push(new Date(t).toISOString().slice(0, 10)); t += 86400000 }
  const serie = keys.map(k => {
    const v = perGiorno.get(k) || { fatturato: 0, costo: 0 }
    return { giorno: k, fatturato: r2(v.fatturato), costo: r2(v.costo), profitto: r2(v.fatturato - v.costo) }
  })

  return NextResponse.json({
    kpi: { profitto, fatturato, costo, margine, spedizioni: nSped, costoMedio, profittoMedio, costoMax: r2(costoMax) },
    costoMaxDettaglio: { ldv: costoMaxLdv, cliente: costoMaxCliente },
    serie, perCorriere, topFatturato, topProfitto,
  })
}
