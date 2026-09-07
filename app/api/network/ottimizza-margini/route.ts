import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// OTTIMIZZA MARGINI — abilitata SOLO ai master col flag `ottimizza_margini` (oggi Ecomize LL). Sola
// lettura. Per ogni CLIENTE, per ZONA (per NOME: le zone sono per-corriere) × PESO, calcola il
// margine ALL-IN (prezzo cliente − costo master, nolo+fuel) di ogni corriere ATTIVO, con
// ARROTONDAMENTO alla fascia del singolo corriere (BRT da 3kg, Poste da 2kg…). Produce RACCOMANDAZIONI
// azionabili: "usa X anziché Y (+€/sped)" e "vendigli anche Z (non nel suo listino)", e stima il
// guadagno potenziale pesando sul VOLUME reale (spedizioni ultimi 90gg del cliente).

type Banda = { peso_max: number; allin: number }
const roundUp = (b: Banda[], w: number): number | null => { for (const x of b) if (w <= x.peso_max) return x.allin; return null }
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

  // Contratti sospesi da un master A MONTE (pausa/disattiva/elimina): la riga del master può essere
  // attivo=true ma il contratto è di fatto non disponibile (es. POSTE DELIVERY EXPRESS D in pausa su
  // MULTIEXPRESS). Stessa regola della pagina Corrieri: se non li escludo, consiglio corrieri che il
  // cliente non può nemmeno usare.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesiSopra = await contrattiSospesiSopra(mio)
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto,attivo').eq('master_id', mio)
  const nomeCorr = new Map<string, string>()
  // Escludo anche i servizi NON comparabili con una spedizione standard (fuori-sagoma "Extralarge"):
  // consigliarli su un collo normale è fuorviante e fa sembrare lo strumento inaffidabile.
  const nonComparabile = (n: string) => /extralarge|fuori\s*sagoma|pallet/i.test(n)
  for (const c of (corr || [])) {
    const nome = (c as any).nome_contratto || 'Corriere'
    if ((c as any).attivo === false) continue
    if (nonComparabile(nome)) continue
    if (sospesoDallaCatena(nome, sospesiSopra)) continue   // in pausa da un master superiore
    nomeCorr.set((c as any).id, nome)
  }
  if (!nomeCorr.size) return NextResponse.json({ attivo: true, clienti: [] })

  const { data: zone } = await admin.from('zone').select('id,nome').eq('master_id', mio)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome]))
  const zn = (zid: any) => nomeZona.get(zid) || '—'

  // COSTO master → costBands[corriere][zonaNome] = Map(peso_max -> allin min)
  const { data: lcorr } = await admin.from('listini_corrieri').select('id').eq('master_id', mio)
  const costIds = (lcorr || []).map((l: any) => l.id)
  const costBands = new Map<string, Map<string, Map<number, number>>>()
  if (costIds.length) {
    const kf = await fetchAll(() => admin.from('listini_corrieri_fasce').select('id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', costIds).eq('tipo', 'fino_a'))
    for (const f of kf) {
      const cid = (f as any).corriere_id; if (!nomeCorr.has(cid)) continue
      const zona = zn((f as any).zona_id); const pm = Number((f as any).peso_max)
      const allin = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100)
      if (!costBands.has(cid)) costBands.set(cid, new Map())
      const pz = costBands.get(cid)!; if (!pz.has(zona)) pz.set(zona, new Map())
      const bm = pz.get(zona)!; if (!bm.has(pm) || allin < bm.get(pm)!) bm.set(pm, allin)
    }
  }
  if (!costBands.size) return NextResponse.json({ attivo: true, clienti: [] })

  const { data: cli } = await admin.from('clienti').select('id,ragione_sociale,listino_cliente_id').eq('master_id', mio).not('listino_cliente_id', 'is', null)
  const listinoIds = [...new Set((cli || []).map((c: any) => c.listino_cliente_id))]
  if (!listinoIds.length) return NextResponse.json({ attivo: true, clienti: [] })
  const clientiDiListino = new Map<string, string[]>()
  const clientIdsDiListino = new Map<string, string[]>()
  for (const c of (cli || [])) {
    const k = (c as any).listino_cliente_id
    if (!clientiDiListino.has(k)) { clientiDiListino.set(k, []); clientIdsDiListino.set(k, []) }
    clientiDiListino.get(k)!.push((c as any).ragione_sociale); clientIdsDiListino.get(k)!.push((c as any).id)
  }

  // VOLUME reale: spedizioni ultimi 90gg per cliente (peso il guadagno potenziale su quello).
  const dal = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  const sped90 = new Map<string, number>()
  const allClientIds = (cli || []).map((c: any) => c.id)
  for (let i = 0; i < allClientIds.length; i += 100) {
    const chunk = allClientIds.slice(i, i + 100)
    const rows = await fetchAll(() => admin.from('spedizioni').select('id,cliente_id').in('cliente_id', chunk).gte('created_at', dal))
    for (const s of rows) { const cid = (s as any).cliente_id; sped90.set(cid, (sped90.get(cid) || 0) + 1) }
  }
  const volumeListino = (lid: string) => (clientIdsDiListino.get(lid) || []).reduce((n, id) => n + (sped90.get(id) || 0), 0)

  // Fasce cliente → clientBands[listino][corriere][zonaNome] = Map(peso_max -> allin)
  const clientBands = new Map<string, Map<string, Map<string, Map<number, number>>>>()
  for (let i = 0; i < listinoIds.length; i += 50) {
    const chunk = listinoIds.slice(i, i + 50)
    const ff = await fetchAll(() => admin.from('listini_clienti_fasce').select('id,listino_id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', chunk).eq('tipo', 'fino_a'))
    for (const f of ff) {
      const cid = (f as any).corriere_id; if (!nomeCorr.has(cid)) continue
      const lid = (f as any).listino_id; const zona = zn((f as any).zona_id); const pm = Number((f as any).peso_max)
      const allin = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100)
      if (!clientBands.has(lid)) clientBands.set(lid, new Map())
      const pc = clientBands.get(lid)!; if (!pc.has(cid)) pc.set(cid, new Map())
      const pz = pc.get(cid)!; if (!pz.has(zona)) pz.set(zona, new Map())
      const bm = pz.get(zona)!; if (!bm.has(pm) || allin < bm.get(pm)!) bm.set(pm, allin)
    }
  }
  const toB = (m?: Map<number, number>): Banda[] => m ? [...m.entries()].map(([peso_max, allin]) => ({ peso_max, allin })).sort((a, b) => a.peso_max - b.peso_max) : []

  const out: any[] = []
  let totalePotenziale = 0
  for (const [lid, perCorr] of clientBands) {
    // per zona: pesi rappresentativi = unione dei peso_max dei corrieri del cliente
    const zonePesi = new Map<string, Set<number>>()
    for (const [, perZona] of perCorr) for (const [zona, bm] of perZona) { if (!zonePesi.has(zona)) zonePesi.set(zona, new Set()); for (const pm of bm.keys()) zonePesi.get(zona)!.add(pm) }
    const racc: any[] = []
    let sommaUplift = 0, nRotte = 0
    for (const [zona, pesiSet] of zonePesi) {
      for (const w of [...pesiSet].sort((a, b) => a - b)) {
        // corrieri del cliente con margine
        const suoi: { corriere: string; cid: string; prezzo: number; costo: number; margine: number }[] = []
        for (const [cid, nome] of nomeCorr) {
          const cb = perCorr.get(cid)?.get(zona); const kb = costBands.get(cid)?.get(zona)
          if (!cb || !kb) continue
          const pc = roundUp(toB(cb), w); const ko = roundUp(toB(kb), w)
          if (pc == null || ko == null) continue
          suoi.push({ corriere: nome, cid, prezzo: r2(pc), costo: r2(ko), margine: r2(pc - ko) })
        }
        if (!suoi.length) continue
        suoi.sort((a, b) => b.margine - a.margine)
        const best = suoi[0], secondo = suoi[1]
        nRotte++
        // "cambia": migliore vs secondo (se >1 corriere e il secondo rende meno)
        if (secondo && best.margine - secondo.margine > 0.009) {
          const up = r2(best.margine - secondo.margine); sommaUplift += up
          racc.push({ tipo: 'cambia', zona, peso: w, usa: best.corriere, margine_usa: best.margine, invece_di: secondo.corriere, margine_invece: secondo.margine, per_spedizione: up })
        }
        // "aggiungi": corriere ATTIVO col costo per questa rotta ma NON nel listino del cliente, che
        // prezzato come il MIGLIORE attuale del cliente renderebbe di più (margine = prezzo_migliore − costo_nuovo).
        const suoiIds = new Set(suoi.map(s => s.cid)); const prezzoMigliore = best.prezzo
        let addBest: { corriere: string; margine: number; costo: number } | null = null
        for (const [cid, nome] of nomeCorr) {
          if (suoiIds.has(cid)) continue
          const kb = costBands.get(cid)?.get(zona); if (!kb) continue
          const ko = roundUp(toB(kb), w); if (ko == null) continue
          const m = r2(prezzoMigliore - ko)
          if (!addBest || m > addBest.margine) addBest = { corriere: nome, margine: m, costo: r2(ko) }
        }
        if (addBest && addBest.margine - best.margine > 0.05) {
          racc.push({ tipo: 'aggiungi', zona, peso: w, corriere: addBest.corriere, margine_stimato: addBest.margine, invece_di: best.corriere, margine_invece: best.margine, per_spedizione: r2(addBest.margine - best.margine), nota: 'non nel listino del cliente (prezzo stimato = quello attuale del migliore)' })
        }
      }
    }
    if (!racc.length) continue
    const vol = volumeListino(lid)
    const upliftMedio = nRotte ? sommaUplift / nRotte : 0
    const stima90 = r2(vol * upliftMedio)   // stima: volume × uplift medio "cambia" per rotta
    totalePotenziale += stima90
    racc.sort((a, b) => (b.per_spedizione || 0) - (a.per_spedizione || 0))
    out.push({ listino_id: lid, clienti: clientiDiListino.get(lid) || [], spedizioni_90gg: vol, stima_guadagno_90gg: stima90, raccomandazioni: racc })
  }
  out.sort((a, b) => (b.stima_guadagno_90gg - a.stima_guadagno_90gg) || (b.spedizioni_90gg - a.spedizioni_90gg))
  return NextResponse.json({ attivo: true, totale_potenziale_90gg: r2(totalePotenziale), clienti: out })
}
