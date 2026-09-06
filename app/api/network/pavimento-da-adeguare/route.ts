import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pavimentiAttivi, pavimentoPerPeso, masterEsentePavimento, bandeDaMappa } from '@/lib/pavimenti'
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
  // Master esente (es. Agenzia Entrate): non ha nulla da adeguare.
  if (await masterEsentePavimento(admin, mio)) return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })

  // Listini del master assegnati a un CLIENTE (M2C). Escludo quelli assegnati a un sotto-master.
  const { data: mieiListini } = await admin.from('listini_clienti').select('id,nome').eq('master_id', mio)
  const listinoNome = new Map<string, string>((mieiListini || []).map((l: any) => [l.id, l.nome || 'Listino']))
  const tuttiIds = [...listinoNome.keys()]
  if (!tuttiIds.length) return NextResponse.json({ totaleFasce: 0, totaleListini: 0, gruppi: [] })

  // Clienti per listino (solo assegnati); e i listini all'ingrosso (parent_listino_id) da escludere.
  const clientiPerListino = new Map<string, string[]>()
  for (let i = 0; i < tuttiIds.length; i += 100) {
    const { data } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id,pavimento_esente').in('listino_cliente_id', tuttiIds.slice(i, i + 100))
    for (const c of (data || [])) {
      if ((c as any).pavimento_esente === true) continue   // cliente esente: non conta come "da adeguare"
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

  // Fasce fino_a di questi listini per questi corrieri, PER ZONA (il pavimento Europa cambia per zona).
  // Ogni riga (listino, corriere, zona, peso) è confrontata col suo pavimento (per i contratti
  // nazionali la zona ricade sul pavimento "tutte le zone").
  const grp = new Map<string, any>()
  let totaleFasce = 0
  for (let i = 0; i < m2cIds.length; i += 50) {
    const chunk = m2cIds.slice(i, i + 50)
    const fasce = await fetchAll(() => admin.from('listini_clienti_fasce')
      .select('id,listino_id,corriere_id,peso_max,prezzo,zone(nome)')
      .in('listino_id', chunk).in('corriere_id', corriereIds).eq('tipo', 'fino_a'))
    for (const f of fasce) {
      const nomeC = nomeDiCorriere.get((f as any).corriere_id) || ''
      const zonaNome = (f as any).zone?.nome || null
      const bande = bandeDaMappa(pav, nomeC, zonaNome); if (!bande.length) continue
      const peso = Number((f as any).peso_max); const prezzo = Number((f as any).prezzo)
      const min = pavimentoPerPeso(bande, peso)
      if (min == null || prezzo >= min - 0.0001) continue
      totaleFasce++
      const k = (f as any).listino_id + '|' + (f as any).corriere_id
      if (!grp.has(k)) grp.set(k, {
        listino_id: (f as any).listino_id, listino_nome: listinoNome.get((f as any).listino_id) || 'Listino',
        corriere_nome: nomeC, clienti: clientiPerListino.get((f as any).listino_id) || [], fasce: [],
      })
      grp.get(k).fasce.push({ peso_max: peso, zona: zonaNome, prezzo: Math.round(prezzo * 100) / 100, pavimento: min })
    }
  }
  const gruppi = [...grp.values()].map(g => ({ ...g, fasce: g.fasce.sort((a: any, b: any) => a.peso_max - b.peso_max || String(a.zona).localeCompare(String(b.zona))) }))
    .sort((a, b) => a.corriere_nome.localeCompare(b.corriere_nome) || a.listino_nome.localeCompare(b.listino_nome))

  return NextResponse.json({ totaleFasce, totaleListini: gruppi.length, gruppi })
}
