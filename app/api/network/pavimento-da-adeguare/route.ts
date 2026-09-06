import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pavimentiAttivi, pavimentoPerPeso } from '@/lib/pavimenti'
import { fetchAll } from '@/lib/fetch-all'

// I TUOI LISTINI CLIENTE SOTTO IL MINIMO DEL CONTRATTO — resoconto per-master, in casa sua.
// Alimenta il banner d'ingresso (conteggio) e la pagina "Listini da adeguare" (dettaglio) + l'editor.
// Solo Master->Cliente: i listini assegnati a un SOTTO-MASTER (parent_listino_id) sono all'ingrosso
// e NON hanno pavimento → esclusi. Vale solo per i contratti con pavimento ATTIVO (oggi nessuno →
// risposta vuota finché non si accende: il banner non compare).
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })
  }
  const mio = utente.master_id
  const admin = createAdminSupabase()

  const pav = await pavimentiAttivi(admin)
  if (!pav.size) return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })

  // Listini del master assegnati a un CLIENTE (M2C). Escludo quelli assegnati a un sotto-master.
  const { data: mieiListini } = await admin.from('listini_clienti').select('id,nome').eq('master_id', mio)
  const listinoNome = new Map<string, string>((mieiListini || []).map((l: any) => [l.id, l.nome || 'Listino']))
  const tuttiIds = [...listinoNome.keys()]
  if (!tuttiIds.length) return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })

  // Clienti per listino (solo assegnati); e i listini all'ingrosso (parent_listino_id) da escludere.
  const clientiPerListino = new Map<string, string[]>()
  for (let i = 0; i < tuttiIds.length; i += 100) {
    const { data } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').in('listino_cliente_id', tuttiIds.slice(i, i + 100))
    for (const c of (data || [])) {
      const k = (c as any).listino_cliente_id
      if (!clientiPerListino.has(k)) clientiPerListino.set(k, [])
      clientiPerListino.get(k)!.push((c as any).ragione_sociale)
    }
  }
  const m2mIds = new Set<string>()
  for (let i = 0; i < tuttiIds.length; i += 100) {
    const { data } = await admin.from('masters').select('parent_listino_id').in('parent_listino_id', tuttiIds.slice(i, i + 100))
    for (const m of (data || [])) if ((m as any).parent_listino_id) m2mIds.add((m as any).parent_listino_id)
  }
  // Listini M2C = assegnati a un cliente e NON assegnati a un sotto-master.
  const m2cIds = tuttiIds.filter(id => clientiPerListino.has(id) && !m2mIds.has(id))
  if (!m2cIds.length) return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })

  // Corrieri con pavimento attivo (per nome) → ids.
  const nomiPav = [...pav.keys()]
  const { data: corrPav } = await admin.from('corrieri').select('id,nome_contratto').eq('tipo', 'spediamopro').in('nome_contratto', nomiPav)
  const nomeDiCorriere = new Map<string, string>((corrPav || []).map((c: any) => [c.id, c.nome_contratto]))
  const corriereIds = [...nomeDiCorriere.keys()]
  if (!corriereIds.length) return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })

  // Fasce fino_a di questi listini per questi corrieri → collasso per (listino,corriere,peso_max) min prezzo.
  const perLBC = new Map<string, { listino_id: string; corriere_id: string; peso_max: number; prezzo: number }>()
  for (let i = 0; i < m2cIds.length; i += 50) {
    const chunk = m2cIds.slice(i, i + 50)
    const fasce = await fetchAll(() => admin.from('listini_clienti_fasce')
      .select('id,listino_id,corriere_id,peso_max,prezzo')
      .in('listino_id', chunk).in('corriere_id', corriereIds).eq('tipo', 'fino_a'))
    for (const f of fasce) {
      const kk = (f as any).listino_id + '|' + (f as any).corriere_id + '|' + (f as any).peso_max
      const p = Number((f as any).prezzo); const cur = perLBC.get(kk)
      if (!cur || p < cur.prezzo) perLBC.set(kk, { listino_id: (f as any).listino_id, corriere_id: (f as any).corriere_id, peso_max: Number((f as any).peso_max), prezzo: p })
    }
  }

  // Sotto pavimento → raggruppo per (listino, corriere).
  const grp = new Map<string, any>()
  let totaleFasce = 0
  for (const v of perLBC.values()) {
    const nomeC = nomeDiCorriere.get(v.corriere_id) || ''
    const bande = pav.get(nomeC); if (!bande) continue
    const min = pavimentoPerPeso(bande, v.peso_max)
    if (min == null || v.prezzo >= min - 0.0001) continue
    totaleFasce++
    const k = v.listino_id + '|' + v.corriere_id
    if (!grp.has(k)) grp.set(k, {
      listino_id: v.listino_id, listino_nome: listinoNome.get(v.listino_id) || 'Listino',
      corriere_nome: nomeC, clienti: clientiPerListino.get(v.listino_id) || [], fasce: [],
    })
    grp.get(k).fasce.push({ peso_max: v.peso_max, prezzo: Math.round(v.prezzo * 100) / 100, pavimento: min })
  }
  const gruppi = [...grp.values()].map(g => ({ ...g, fasce: g.fasce.sort((a: any, b: any) => a.peso_max - b.peso_max) }))
    .sort((a, b) => a.corriere_nome.localeCompare(b.corriere_nome) || a.listino_nome.localeCompare(b.listino_nome))

  return NextResponse.json({ totaleFasce, totaleListini: gruppi.length, gruppi })
}
