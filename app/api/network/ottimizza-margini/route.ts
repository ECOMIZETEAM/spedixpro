import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { pavimentiAttivi, bandeDaMappa, pavimentoPerPeso } from '@/lib/pavimenti'

// OTTIMIZZA MARGINI — solo master col flag `ottimizza_margini` (oggi Ecomize LL). Sola lettura.
// LOGICA: il corriere lo sceglie il CLIENTE (di solito il più economico per lui). Quindi per far
// guadagnare di più il master NON gli si dice "sposta", ma si mette il corriere che COSTA MENO al
// master allo STESSO prezzo più basso attuale del cliente: così in creazione il cliente lo vede al
// miglior prezzo (o uguale), lo usa, e il master guadagna la differenza di COSTO. Per ogni rotta
// (cliente × zona × peso) si consiglia di AGGIUNGERE (se non nel listino) o ALLINEARE (se c'è ma più
// caro) quel corriere al prezzo P, con il guadagno per spedizione = costo_attuale − costo_migliore.
// Esclusi: attivo=false, non comparabili (extralarge/pallet), sospesi a monte (catena).

type Banda = { peso_max: number; val: number }
type ZonaInfo = { zona_id: string; bande: Banda[] }
const roundUpBanda = (b: Banda[], w: number): Banda | null => { for (const x of b) if (w <= x.peso_max) return x; return null }
const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _b = bloccaAgente(utente as any); if (_b) return _b
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ attivo: false, clienti: [] })
  const mio = utente.master_id
  const admin = createAdminSupabase()
  const { data: mst } = await admin.from('masters').select('ottimizza_margini').eq('id', mio).maybeSingle()
  if ((mst as any)?.ottimizza_margini !== true) return NextResponse.json({ attivo: false, clienti: [] })

  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesiSopra = await contrattiSospesiSopra(mio)
  const pav = await pavimentiAttivi(admin)

  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto,attivo').eq('master_id', mio)
  const nomeCorr = new Map<string, string>()
  const nonComparabile = (n: string) => /extralarge|fuori\s*sagoma|pallet/i.test(n)
  for (const c of (corr || [])) {
    const nome = (c as any).nome_contratto || 'Corriere'
    if ((c as any).attivo === false || nonComparabile(nome) || sospesoDallaCatena(nome, sospesiSopra)) continue
    nomeCorr.set((c as any).id, nome)
  }
  if (!nomeCorr.size) return NextResponse.json({ attivo: true, clienti: [] })

  const { data: zone } = await admin.from('zone').select('id,nome').eq('master_id', mio)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome]))
  const zn = (zid: any) => nomeZona.get(zid) || '—'

  // COSTO master → costInfo[cid][zonaNome] = { zona_id, bande all-in }
  const { data: lcorr } = await admin.from('listini_corrieri').select('id').eq('master_id', mio)
  const costIds = (lcorr || []).map((l: any) => l.id)
  const costInfo = new Map<string, Map<string, ZonaInfo>>()
  if (costIds.length) {
    const kf = await fetchAll(() => admin.from('listini_corrieri_fasce').select('id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', costIds).eq('tipo', 'fino_a'))
    for (const f of kf) {
      const cid = (f as any).corriere_id; if (!nomeCorr.has(cid)) continue
      const zona = zn((f as any).zona_id); const pm = Number((f as any).peso_max)
      const allin = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100)
      if (!costInfo.has(cid)) costInfo.set(cid, new Map())
      const pz = costInfo.get(cid)!; if (!pz.has(zona)) pz.set(zona, { zona_id: (f as any).zona_id, bande: [] })
      const zi = pz.get(zona)!; const ex = zi.bande.find(b => b.peso_max === pm)
      if (ex) { if (allin < ex.val) ex.val = allin } else zi.bande.push({ peso_max: pm, val: allin })
    }
    for (const pz of costInfo.values()) for (const zi of pz.values()) zi.bande.sort((a, b) => a.peso_max - b.peso_max)
  }
  if (!costInfo.size) return NextResponse.json({ attivo: true, clienti: [] })

  const { data: cli } = await admin.from('clienti').select('id,ragione_sociale,listino_cliente_id').eq('master_id', mio).not('listino_cliente_id', 'is', null)
  const listinoIds = [...new Set((cli || []).map((c: any) => c.listino_cliente_id))]
  if (!listinoIds.length) return NextResponse.json({ attivo: true, clienti: [] })
  const clientiDiListino = new Map<string, string[]>(); const clientIdsDiListino = new Map<string, string[]>()
  for (const c of (cli || [])) { const k = (c as any).listino_cliente_id; if (!clientiDiListino.has(k)) { clientiDiListino.set(k, []); clientIdsDiListino.set(k, []) } clientiDiListino.get(k)!.push((c as any).ragione_sociale); clientIdsDiListino.get(k)!.push((c as any).id) }

  const dal = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  const sped90 = new Map<string, number>()
  const allClientIds = (cli || []).map((c: any) => c.id)
  for (let i = 0; i < allClientIds.length; i += 100) {
    const rows = await fetchAll(() => admin.from('spedizioni').select('id,cliente_id').in('cliente_id', allClientIds.slice(i, i + 100)).gte('created_at', dal))
    for (const s of rows) { const cid = (s as any).cliente_id; sped90.set(cid, (sped90.get(cid) || 0) + 1) }
  }
  const volumeListino = (lid: string) => (clientIdsDiListino.get(lid) || []).reduce((n, id) => n + (sped90.get(id) || 0), 0)

  // Prezzi cliente → clientInfo[lid][cid][zonaNome] = { zona_id, bande prezzo all-in }
  const clientInfo = new Map<string, Map<string, Map<string, ZonaInfo>>>()
  for (let i = 0; i < listinoIds.length; i += 50) {
    const ff = await fetchAll(() => admin.from('listini_clienti_fasce').select('id,listino_id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', listinoIds.slice(i, i + 50)).eq('tipo', 'fino_a'))
    for (const f of ff) {
      const cid = (f as any).corriere_id; if (!nomeCorr.has(cid)) continue
      const lid = (f as any).listino_id; const zona = zn((f as any).zona_id); const pm = Number((f as any).peso_max)
      const allin = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100)
      if (!clientInfo.has(lid)) clientInfo.set(lid, new Map())
      const pc = clientInfo.get(lid)!; if (!pc.has(cid)) pc.set(cid, new Map())
      const pz = pc.get(cid)!; if (!pz.has(zona)) pz.set(zona, { zona_id: (f as any).zona_id, bande: [] })
      const zi = pz.get(zona)!; const ex = zi.bande.find(b => b.peso_max === pm)
      if (ex) { if (allin < ex.val) ex.val = allin } else zi.bande.push({ peso_max: pm, val: allin })
    }
    for (const pc of clientInfo.values()) for (const pz of pc.values()) for (const zi of pz.values()) zi.bande.sort((a, b) => a.peso_max - b.peso_max)
  }

  const out: any[] = []
  let totalePotenziale = 0
  for (const [lid, perCorr] of clientInfo) {
    const zonePesi = new Map<string, Set<number>>()
    for (const [, perZona] of perCorr) for (const [zona, zi] of perZona) { if (!zonePesi.has(zona)) zonePesi.set(zona, new Set()); for (const b of zi.bande) zonePesi.get(zona)!.add(b.peso_max) }
    const racc: any[] = []; let sommaUplift = 0, nRotte = 0
    for (const [zona, pesiSet] of zonePesi) {
      for (const w of [...pesiSet].sort((a, b) => a - b)) {
        // prezzo più basso ATTUALE del cliente su questa rotta (P) + costo del corriere che ce l'ha (Acost)
        let P: number | null = null, Acost: number | null = null, Anome = ''
        for (const [cid, nome] of nomeCorr) {
          const cb = perCorr.get(cid)?.get(zona); const kb = costInfo.get(cid)?.get(zona)
          if (!cb || !kb) continue
          const pr = roundUpBanda(cb.bande, w); const co = roundUpBanda(kb.bande, w)
          if (!pr || !co) continue
          if (P == null || pr.val < P) { P = pr.val; Acost = co.val; Anome = nome }
        }
        if (P == null) continue
        nRotte++
        // corriere che COSTA MENO su questa rotta (fra tutti gli usabili), con la sua zona_id/banda per l'apply
        let B: { cid: string; nome: string; cost: number; zona_id: string; peso_max: number } | null = null
        for (const [cid, nome] of nomeCorr) {
          const kb = costInfo.get(cid)?.get(zona); if (!kb) continue
          const co = roundUpBanda(kb.bande, w); if (!co) continue
          if (!B || co.val < B.cost) B = { cid, nome, cost: co.val, zona_id: kb.zona_id, peso_max: co.peso_max }
        }
        if (!B || Acost == null || B.cost >= Acost - 0.009) continue   // nessun corriere costa meno: già ottimale
        // il prezzo competitivo P dev'essere ≥ pavimento di B (altrimenti non lo posso mettere a quel prezzo)
        const min = pavimentoPerPeso(bandeDaMappa(pav, B.nome, zona), w)
        if (min != null && P < min - 0.0001) continue
        const inListino = !!perCorr.get(B.cid)?.get(zona)
        const uplift = r2(Acost - B.cost); sommaUplift += uplift
        racc.push({
          tipo: inListino ? 'allinea' : 'aggiungi', zona, peso: w,
          corriere: B.nome, prezzo: r2(P), corriere_attuale: Anome,
          margine_nuovo: r2(P - B.cost), margine_attuale: r2(P - Acost), per_spedizione: uplift,
          apply: { corriere_id: B.cid, zona_id: B.zona_id, peso_max: B.peso_max, prezzo: r2(P) },
        })
      }
    }
    if (!racc.length) continue
    const vol = volumeListino(lid)
    const stima90 = r2(vol * (nRotte ? sommaUplift / nRotte : 0))
    totalePotenziale += stima90
    racc.sort((a, b) => (b.per_spedizione || 0) - (a.per_spedizione || 0))
    out.push({ listino_id: lid, clienti: clientiDiListino.get(lid) || [], spedizioni_90gg: vol, stima_guadagno_90gg: stima90, raccomandazioni: racc })
  }
  out.sort((a, b) => (b.stima_guadagno_90gg - a.stima_guadagno_90gg) || (b.spedizioni_90gg - a.spedizioni_90gg))
  return NextResponse.json({ attivo: true, totale_potenziale_90gg: r2(totalePotenziale), clienti: out })
}
