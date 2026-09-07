import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// OTTIMIZZA MARGINI — per-master, in casa sua (sola lettura). Per ogni CLIENTE, per ZONA (per NOME,
// non per id: le zone sono per-corriere) e per PESO rappresentativo, calcola il margine ALL-IN
// (prezzo cliente − costo master, nolo+fuel) di ogni corriere ATTIVO che copre quel peso, con
// ARROTONDAMENTO alla fascia del singolo corriere (BRT parte da 3kg, Poste da 2kg…): così i corrieri
// si confrontano davvero sulla stessa destinazione/peso. Indica il migliore e il guadagno vs gli altri.
// Contrassegno/assicurazione/sponda dipendono dal singolo invio → non entrano nel confronto.

type Banda = { peso_max: number; allin: number }
const roundUp = (bande: Banda[], w: number): number | null => { for (const b of bande) if (w <= b.peso_max) return b.allin; return null } // oltre l'ultima fascia: il corriere non copre quel peso qui

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _b = bloccaAgente(utente as any); if (_b) return _b
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ clienti: [] })
  const mio = utente.master_id
  const admin = createAdminSupabase()

  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto,attivo').eq('master_id', mio)
  const nomeCorr = new Map<string, string>()
  for (const c of (corr || [])) if ((c as any).attivo !== false) nomeCorr.set((c as any).id, (c as any).nome_contratto || 'Corriere')
  if (!nomeCorr.size) return NextResponse.json({ clienti: [] })

  const { data: zone } = await admin.from('zone').select('id,nome').eq('master_id', mio)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome]))
  const zn = (zid: any) => nomeZona.get(zid) || '—'

  // COSTO master → costBands[corriere][zonaNome] = bande ordinate (all-in min).
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
  if (!costBands.size) return NextResponse.json({ clienti: [] })

  const { data: cli } = await admin.from('clienti').select('id,ragione_sociale,listino_cliente_id').eq('master_id', mio).not('listino_cliente_id', 'is', null)
  const listinoIds = [...new Set((cli || []).map((c: any) => c.listino_cliente_id))]
  if (!listinoIds.length) return NextResponse.json({ clienti: [] })
  const clientiDiListino = new Map<string, string[]>()
  for (const c of (cli || [])) { const k = (c as any).listino_cliente_id; if (!clientiDiListino.has(k)) clientiDiListino.set(k, []); clientiDiListino.get(k)!.push((c as any).ragione_sociale) }

  // Fasce cliente → clientBands[listino][corriere][zonaNome] = bande.
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

  const sortBande = (m: Map<number, number>): Banda[] => [...m.entries()].map(([peso_max, allin]) => ({ peso_max, allin })).sort((a, b) => a.peso_max - b.peso_max)

  const out: any[] = []
  for (const [lid, perCorr] of clientBands) {
    // zone-nome presenti in questo listino + pesi rappresentativi per zona (unione dei peso_max dei corrieri)
    const zonePesi = new Map<string, Set<number>>()
    for (const [, perZona] of perCorr) for (const [zona, bm] of perZona) { if (!zonePesi.has(zona)) zonePesi.set(zona, new Set()); for (const pm of bm.keys()) zonePesi.get(zona)!.add(pm) }
    const rotte: any[] = []
    for (const [zona, pesiSet] of zonePesi) {
      for (const w of [...pesiSet].sort((a, b) => a - b)) {
        const righe: { corriere: string; prezzo_cliente: number; costo: number; margine: number }[] = []
        for (const [cid, nome] of nomeCorr) {
          const cb = perCorr.get(cid)?.get(zona); const kb = costBands.get(cid)?.get(zona)
          if (!cb || !kb) continue
          const pc = roundUp(sortBande(cb), w); const ko = roundUp(sortBande(kb), w)
          if (pc == null || ko == null) continue
          righe.push({ corriere: nome, prezzo_cliente: Math.round(pc * 100) / 100, costo: Math.round(ko * 100) / 100, margine: Math.round((pc - ko) * 100) / 100 })
        }
        if (righe.length < 1) continue
        righe.sort((a, b) => b.margine - a.margine)
        rotte.push({ zona, peso_max: w, migliore: righe[0].corriere, margine_migliore: righe[0].margine, guadagno_vs_secondo: righe[1] ? Math.round((righe[0].margine - righe[1].margine) * 100) / 100 : null, corrieri: righe })
      }
    }
    if (!rotte.length) continue
    rotte.sort((a, b) => a.zona.localeCompare(b.zona) || a.peso_max - b.peso_max)
    out.push({ listino_id: lid, clienti: clientiDiListino.get(lid) || [], rotte })
  }
  out.sort((a, b) => (a.clienti[0] || '').localeCompare(b.clienti[0] || ''))
  return NextResponse.json({ clienti: out, corrieri_attivi: [...nomeCorr.values()] })
}
