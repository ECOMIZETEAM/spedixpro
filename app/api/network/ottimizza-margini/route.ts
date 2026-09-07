import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// OTTIMIZZA MARGINI — per-master, in casa sua (sola lettura, nessuna modifica).
// Per ogni CLIENTE del master, per ogni ZONA × FASCIA, calcola il margine ALL-IN (nolo + fuel) di
// ciascun corriere ATTIVO che ha sia il prezzo cliente sia il costo del master, e indica il corriere
// col margine più alto e l'aumento rispetto agli altri. Serve a capire dove conviene spingere/riprezzare.
// NB: contrassegno/assicurazione dipendono dal singolo invio e la sponda solo da pesi/misure fuori
// standard → non entrano nel confronto per-rotta (sono extra situazionali, uguali o quasi tra corrieri).
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _b = bloccaAgente(utente as any); if (_b) return _b
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ clienti: [] })
  const mio = utente.master_id
  const admin = createAdminSupabase()

  // Corrieri ATTIVI del master (nome) — solo questi si confrontano.
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto,attivo').eq('master_id', mio)
  const nomeCorr = new Map<string, string>()
  for (const c of (corr || [])) if ((c as any).attivo !== false) nomeCorr.set((c as any).id, (c as any).nome_contratto || 'Corriere')
  if (!nomeCorr.size) return NextResponse.json({ clienti: [] })

  const { data: zone } = await admin.from('zone').select('id,nome').eq('master_id', mio)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome]))

  // COSTO del master (listini_corrieri) → mappa (corriere|zona|peso_max) -> {prezzo,fuel} minimo.
  const { data: lcorr } = await admin.from('listini_corrieri').select('id').eq('master_id', mio)
  const costIds = (lcorr || []).map((l: any) => l.id)
  const costo = new Map<string, { prezzo: number; fuel: number }>()
  if (costIds.length) {
    const kf = await fetchAll(() => admin.from('listini_corrieri_fasce').select('id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', costIds).eq('tipo', 'fino_a'))
    for (const f of kf) {
      const k = (f as any).corriere_id + '|' + (f as any).zona_id + '|' + (f as any).peso_max
      const allin = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100)
      const cur = costo.get(k)
      if (!cur || allin < cur.prezzo) costo.set(k, { prezzo: allin, fuel: Number((f as any).fuel) || 0 })
    }
  }
  if (!costo.size) return NextResponse.json({ clienti: [] })

  // Clienti del master + loro listino.
  const { data: cli } = await admin.from('clienti').select('id,ragione_sociale,listino_cliente_id').eq('master_id', mio).not('listino_cliente_id', 'is', null)
  const listinoIds = [...new Set((cli || []).map((c: any) => c.listino_cliente_id))]
  if (!listinoIds.length) return NextResponse.json({ clienti: [] })

  // Fasce cliente (all-in) per listino.
  const fasceCli: any[] = []
  for (let i = 0; i < listinoIds.length; i += 50) {
    const chunk = listinoIds.slice(i, i + 50)
    const ff = await fetchAll(() => admin.from('listini_clienti_fasce').select('id,listino_id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', chunk).eq('tipo', 'fino_a'))
    fasceCli.push(...ff)
  }

  // Raggruppo per (listino, zona, peso_max) → margini per corriere.
  type Riga = { corriere: string; prezzo_cliente: number; costo: number; margine: number }
  const perRotta = new Map<string, { listino_id: string; zona: string; peso_max: number; righe: Riga[] }>()
  for (const f of fasceCli) {
    const cid = (f as any).corriere_id
    const nome = nomeCorr.get(cid); if (!nome) continue      // corriere non attivo / non del master
    const k = cid + '|' + (f as any).zona_id + '|' + (f as any).peso_max
    const c = costo.get(k); if (!c) continue                 // niente costo per questa cella → non confrontabile
    const clienteAllin = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100)
    const margine = Math.round((clienteAllin - c.prezzo) * 100) / 100
    const rk = (f as any).listino_id + '|' + (f as any).zona_id + '|' + (f as any).peso_max
    if (!perRotta.has(rk)) perRotta.set(rk, { listino_id: (f as any).listino_id, zona: nomeZona.get((f as any).zona_id) || '—', peso_max: Number((f as any).peso_max), righe: [] })
    perRotta.get(rk)!.righe.push({ corriere: nome, prezzo_cliente: Math.round(clienteAllin * 100) / 100, costo: Math.round(c.prezzo * 100) / 100, margine })
  }

  // Nome cliente per listino (un listino può avere più clienti).
  const clientiDiListino = new Map<string, string[]>()
  for (const c of (cli || [])) { const k = (c as any).listino_cliente_id; if (!clientiDiListino.has(k)) clientiDiListino.set(k, []); clientiDiListino.get(k)!.push((c as any).ragione_sociale) }

  // Assemblo per cliente/listino: rotte con corrieri ordinati per margine, best + delta col secondo.
  const perListino = new Map<string, any[]>()
  for (const r of perRotta.values()) {
    if (r.righe.length < 1) continue
    r.righe.sort((a, b) => b.margine - a.margine)
    const best = r.righe[0]
    const secondo = r.righe[1]
    const guadagnoInPiu = secondo ? Math.round((best.margine - secondo.margine) * 100) / 100 : null
    if (!perListino.has(r.listino_id)) perListino.set(r.listino_id, [])
    perListino.get(r.listino_id)!.push({ zona: r.zona, peso_max: r.peso_max, migliore: best.corriere, margine_migliore: best.margine, guadagno_vs_secondo: guadagnoInPiu, corrieri: r.righe })
  }

  const clienti = [...perListino.entries()].map(([lid, rotte]) => ({
    listino_id: lid,
    clienti: clientiDiListino.get(lid) || [],
    rotte: rotte.sort((a: any, b: any) => a.zona.localeCompare(b.zona) || a.peso_max - b.peso_max),
    // opportunità = somma dei "guadagno vs secondo" dove il best non è ovvio (indice grezzo di potenziale)
    rotte_multi: rotte.filter((x: any) => x.corrieri.length > 1).length,
  })).sort((a, b) => (a.clienti[0] || '').localeCompare(b.clienti[0] || ''))

  return NextResponse.json({ clienti, corrieri_attivi: [...nomeCorr.values()] })
}
