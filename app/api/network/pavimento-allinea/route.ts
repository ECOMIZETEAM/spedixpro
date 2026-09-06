import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pavimentiAttivi, pavimentoPerPeso, masterEsentePavimento, bandeDaMappa } from '@/lib/pavimenti'
import { fetchAll } from '@/lib/fetch-all'

// ALLINEA i listini CLIENTE sotto il minimo del contratto. Money-safe:
//  - solo listini del master loggato (ownership), solo Master->Cliente (i listini all'ingrosso ai
//    sotto-master, parent_listino_id, sono esclusi);
//  - tocca SOLO le fasce fino_a sotto il pavimento, e SOLO in AUMENTO (mai abbassa un prezzo);
//  - base: 'pavimento' (porta al minimo) o 'attuale' (parte dal prezzo attuale);
//    margine: 'fisso' (+€) o 'perc' (+%). new = base (+ €) oppure base * (1 + %/100).
// Opzionale: listino_id (un solo listino) e corriere_nome (un solo contratto). Ritorna il resoconto.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id

  const body = await req.json().catch(() => ({}))
  const base = body?.base === 'attuale' ? 'attuale' : 'pavimento'
  const margineTipo = body?.margineTipo === 'perc' ? 'perc' : 'fisso'
  const margineValore = Math.max(0, Number(body?.margineValore) || 0)
  const soloListino: string | null = body?.listinoId || null
  const soloContratto: string | null = body?.corriereNome || null

  const admin = createAdminSupabase()
  if (await masterEsentePavimento(admin, mio)) return NextResponse.json({ success: true, aggiornate: 0, esente: true })
  const pav = await pavimentiAttivi(admin)
  if (!pav.size) return NextResponse.json({ error: 'Nessun pavimento attivo' }, { status: 400 })

  // Listini M2C del master (assegnati a un cliente, non a un sotto-master).
  const { data: mieiListini } = await admin.from('listini_clienti').select('id').eq('master_id', mio)
  let ids = (mieiListini || []).map((l: any) => l.id)
  if (soloListino) ids = ids.filter((x: string) => x === soloListino)
  if (!ids.length) return NextResponse.json({ error: 'Nessun listino' }, { status: 400 })
  const assegnati = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('clienti').select('listino_cliente_id,pavimento_esente').in('listino_cliente_id', ids.slice(i, i + 100))
    for (const c of (data || [])) if ((c as any).listino_cliente_id && (c as any).pavimento_esente !== true) assegnati.add((c as any).listino_cliente_id)
  }
  const m2m = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('masters').select('parent_listino_id').in('parent_listino_id', ids.slice(i, i + 100))
    for (const m of (data || [])) if ((m as any).parent_listino_id) m2m.add((m as any).parent_listino_id)
  }
  const m2cIds = ids.filter((id: string) => assegnati.has(id) && !m2m.has(id))
  if (!m2cIds.length) return NextResponse.json({ error: 'Nessun listino cliente da adeguare' }, { status: 400 })

  // Corrieri con pavimento attivo (eventualmente ristretto al contratto scelto).
  let nomiPav = [...pav.keys()]
  if (soloContratto) nomiPav = nomiPav.filter(n => n === soloContratto)
  if (!nomiPav.length) return NextResponse.json({ error: 'Contratto senza pavimento attivo' }, { status: 400 })
  const { data: corrPav } = await admin.from('corrieri').select('id,nome_contratto').eq('tipo', 'spediamopro').in('nome_contratto', nomiPav)
  const nomeDiCorriere = new Map<string, string>((corrPav || []).map((c: any) => [c.id, c.nome_contratto]))
  const corriereIds = [...nomeDiCorriere.keys()]
  if (!corriereIds.length) return NextResponse.json({ error: 'Nessun corriere' }, { status: 400 })

  // Fasce fino_a sotto pavimento → calcolo il nuovo prezzo (solo aumento) e aggiorno per id.
  let aggiornate = 0
  const esempi: any[] = []
  const arrotonda = (n: number) => Math.round(n * 100) / 100
  for (let i = 0; i < m2cIds.length; i += 50) {
    const chunk = m2cIds.slice(i, i + 50)
    const fasce = await fetchAll(() => admin.from('listini_clienti_fasce')
      .select('id,corriere_id,peso_max,prezzo,zone(nome)')
      .in('listino_id', chunk).in('corriere_id', corriereIds).eq('tipo', 'fino_a'))
    for (const f of fasce) {
      const nomeC = nomeDiCorriere.get((f as any).corriere_id) || ''
      const bande = bandeDaMappa(pav, nomeC, (f as any).zone?.nome); if (!bande.length) continue
      const min = pavimentoPerPeso(bande, Number((f as any).peso_max)); if (min == null) continue
      const attuale = Number((f as any).prezzo)
      if (attuale >= min - 0.0001) continue   // già a pavimento o sopra: non tocco
      const partenza = base === 'attuale' ? attuale : min
      const nuovo = arrotonda(margineTipo === 'perc' ? partenza * (1 + margineValore / 100) : partenza + margineValore)
      if (nuovo <= attuale + 0.0001) continue  // mai abbassare / nessun cambiamento
      const { error } = await admin.from('listini_clienti_fasce').update({ prezzo: nuovo }).eq('id', (f as any).id)
      if (!error) { aggiornate++; if (esempi.length < 8) esempi.push({ corriere: nomeC, peso_max: Number((f as any).peso_max), da: attuale, a: nuovo, minimo: min }) }
    }
  }

  return NextResponse.json({ success: true, aggiornate, base, margineTipo, margineValore, esempi })
}
